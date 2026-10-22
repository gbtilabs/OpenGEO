#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <limits.h>

static void require(BOOL condition, NSString *message) {
  if (!condition) @throw [NSException exceptionWithName:@"FixtureRefusal" reason:message userInfo:nil];
}
static void check(OSStatus status, NSString *operation) {
  require(status == errSecSuccess, [NSString stringWithFormat:@"%@: OSStatus %d", operation, (int)status]);
}
static NSString *keychainPath(SecKeychainRef keychain) {
  char path[PATH_MAX]; UInt32 size = sizeof(path);
  check(SecKeychainGetPath(keychain, &size, path), @"Read keychain path");
  return [[NSString alloc] initWithBytes:path length:strlen(path) encoding:NSUTF8StringEncoding];
}
static NSArray *searchPaths(void) {
  CFArrayRef list = NULL; check(SecKeychainCopySearchList(&list), @"Read search list");
  NSMutableArray *paths = [NSMutableArray array];
  for (id object in (__bridge NSArray *)list) [paths addObject:keychainPath((__bridge SecKeychainRef)object)];
  CFRelease(list); return paths;
}
static SecKeychainRef openKeychain(NSString *path) {
  SecKeychainRef keychain = NULL; check(SecKeychainOpen(path.fileSystemRepresentation, &keychain), @"Open declared keychain");
  return keychain;
}
static void writeJSON(id value, NSString *path) {
  NSError *error = nil; NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:&error];
  require(data != nil && [data writeToFile:path options:NSDataWritingAtomic error:&error], @"Write fixture receipt");
}
static void restore(NSDictionary *state) {
  SecKeychainRef original = openKeychain(state[@"default"]);
  check(SecKeychainSetDefault(original), @"Restore original default"); CFRelease(original);
  NSMutableArray *list = [NSMutableArray array];
  for (NSString *path in state[@"search"]) { SecKeychainRef keychain = openKeychain(path); [list addObject:CFBridgingRelease(keychain)]; }
  check(SecKeychainSetSearchList((__bridge CFArrayRef)list), @"Restore original search list");
  require([searchPaths() isEqual:state[@"search"]], @"Original search list did not restore exactly");
  SecKeychainRef observed = NULL; check(SecKeychainCopyDefault(&observed), @"Read restored default");
  require([keychainPath(observed) isEqual:state[@"default"]], @"Original default did not restore exactly"); CFRelease(observed);
  if ([[NSFileManager defaultManager] fileExistsAtPath:state[@"fixture"]]) {
    SecKeychainRef fixture = openKeychain(state[@"fixture"]);
    check(SecKeychainDelete(fixture), @"Delete only owned fixture keychain"); CFRelease(fixture);
  }
}

int main(int argc, const char *argv[]) { @autoreleasepool {
  @try {
    NSDictionary *env = NSProcessInfo.processInfo.environment;
    require([env[@"GITHUB_ACTIONS"] isEqual:@"true"] && [env[@"RUNNER_OS"] isEqual:@"macOS"] && [env[@"GITHUB_REPOSITORY"] isEqual:@"surfacedby/OpenGEO"], @"This fixture is restricted to disposable OpenGEO GitHub Mac runners");
    require(argc == 3 || argc == 5, @"Expected setup directory old-app new-app, or cleanup directory");
    NSString *mode = @(argv[1]), *directory = [@(argv[2]) stringByResolvingSymlinksInPath];
    NSString *temporary = [env[@"RUNNER_TEMP"] stringByResolvingSymlinksInPath];
    require([directory hasPrefix:[temporary stringByAppendingString:@"/"]] && [[directory lastPathComponent] hasPrefix:@"release-macos-"], @"Fixture directory must be an owned release directory");
    NSString *stateFile = [directory stringByAppendingPathComponent:@"keychain-state.json"];
    if ([mode isEqual:@"cleanup"]) {
      NSDictionary *state = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:stateFile] options:0 error:nil];
      require([state[@"fixture"] isEqual:[directory stringByAppendingPathComponent:@"upgrade-fixture.keychain-db"]], @"Fixture cleanup scope changed");
      restore(state); writeJSON(@{@"originalDefaultAndSearchRestored":@YES, @"ownedKeychainRemoved":@YES}, [directory stringByAppendingPathComponent:@"keychain-cleanup.json"]);
      return 0;
    }
    require([mode isEqual:@"setup"] && argc == 5 && ![[NSFileManager defaultManager] fileExistsAtPath:stateFile], @"Never replace an existing fixture");
    SecKeychainRef original = NULL; check(SecKeychainCopyDefault(&original), @"Read original default");
    NSString *path = [directory stringByAppendingPathComponent:@"upgrade-fixture.keychain-db"];
    require(![[NSFileManager defaultManager] fileExistsAtPath:path], @"Fixture path already exists");
    NSDictionary *state = @{@"default":keychainPath(original), @"search":searchPaths(), @"fixture":path}; CFRelease(original);
    SecTrustedApplicationRef oldApp = NULL, newApp = NULL;
    check(SecTrustedApplicationCreateFromPath(argv[3], &oldApp), @"Bind old installer code");
    check(SecTrustedApplicationCreateFromPath(argv[4], &newApp), @"Bind new installer code");
    NSArray *trusted = @[CFBridgingRelease(oldApp), CFBridgingRelease(newApp)];
    SecAccessRef access = NULL; check(SecAccessCreate(CFSTR("OpenGEO Safe Storage"), (__bridge CFArrayRef)trusted, &access), @"Authorize only the two reviewed programs");
    unsigned char random[64]; check(SecRandomCopyBytes(kSecRandomDefault, sizeof(random), random), @"Create synthetic fixture entropy");
    NSData *password = [[[NSData dataWithBytes:random length:32] base64EncodedStringWithOptions:0] dataUsingEncoding:NSUTF8StringEncoding];
    NSData *secret = [[[NSData dataWithBytes:random + 32 length:32] base64EncodedStringWithOptions:0] dataUsingEncoding:NSUTF8StringEncoding];
    SecKeychainRef fixture = NULL; check(SecKeychainCreate(path.fileSystemRepresentation, (UInt32)password.length, password.bytes, false, NULL, &fixture), @"Create owned keychain");
    writeJSON(state, stateFile);
    @try {
      const char *service = "OpenGEO Safe Storage", *account = "OpenGEO";
      SecKeychainAttribute attributes[] = {{kSecServiceItemAttr, (UInt32)strlen(service), (void *)service}, {kSecAccountItemAttr, (UInt32)strlen(account), (void *)account}};
      SecKeychainAttributeList attributesList = {2, attributes}; SecKeychainItemRef item = NULL;
      check(SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &attributesList, (UInt32)secret.length, secret.bytes, fixture, access, &item), @"Create synthetic OS storage item");
      SecAccessRef actual = NULL; check(SecKeychainItemCopyAccess(item, &actual), @"Read actual item access");
      CFArrayRef acls = SecAccessCopyMatchingACLList(actual, kSecACLAuthorizationDecrypt);
      require(acls && CFArrayGetCount(acls) == 1, @"Expected one decrypt ACL");
      CFArrayRef applications = NULL; CFStringRef description = NULL; SecKeychainPromptSelector selector;
      check(SecACLCopyContents((SecACLRef)CFArrayGetValueAtIndex(acls, 0), &applications, &description, &selector), @"Read actual trusted programs");
      require(applications && CFArrayGetCount(applications) == 2, @"Never allow all applications or add another decrypt client");
      NSMutableSet *expectedPrograms = [NSMutableSet set], *observedPrograms = [NSMutableSet set];
      for (CFIndex index = 0; index < 2; index++) {
        CFDataRef expected = NULL, observed = NULL;
        check(SecTrustedApplicationCopyData((__bridge SecTrustedApplicationRef)trusted[index], &expected), @"Read expected code identity");
        check(SecTrustedApplicationCopyData((SecTrustedApplicationRef)CFArrayGetValueAtIndex(applications, index), &observed), @"Read installed code identity");
        [expectedPrograms addObject:CFBridgingRelease(expected)]; [observedPrograms addObject:CFBridgingRelease(observed)];
      }
      require(expectedPrograms.count == 2 && [expectedPrograms isEqual:observedPrograms], @"Trusted application identities changed");
      CFRelease(applications); if (description) CFRelease(description); CFRelease(acls); CFRelease(actual); CFRelease(item); CFRelease(access);
      check(SecKeychainSetDefault(fixture), @"Select owned fixture default");
      check(SecKeychainSetSearchList((__bridge CFArrayRef)@[(__bridge id)fixture]), @"Select only owned fixture search list");
      require([searchPaths() isEqual:@[path]], @"Fixture search list differs");
      writeJSON(@{@"syntheticItemOnly":@YES, @"trustedDecryptClients":@2, @"explicitFixtureOwnerConsent":@YES, @"realLoginKeychainUntouched":@YES,
        @"scope":@"Preauthorization of exact old and new code identities in one disposable keychain; not an automated system-dialog test"}, [directory stringByAppendingPathComponent:@"keychain-consent.json"]);
      CFRelease(fixture);
    } @catch (NSException *error) { restore(state); @throw error; }
    return 0;
  } @catch (NSException *error) { fprintf(stderr, "%s\n", error.reason.UTF8String); return 1; }
} }
