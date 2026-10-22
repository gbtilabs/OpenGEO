#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>

static void fixtureRequire(BOOL condition, NSString *message) {
  if (!condition) @throw [NSException exceptionWithName:@"FixtureRefusal" reason:message userInfo:nil];
}
static void fixtureStatus(OSStatus status, NSString *operation) {
  fixtureRequire(status == errSecSuccess, [NSString stringWithFormat:@"%@: OSStatus %d", operation, (int)status]);
}
static NSString *keychainPath(SecKeychainRef keychain) {
  char path[PATH_MAX]; UInt32 size = sizeof(path);
  fixtureStatus(SecKeychainGetPath(keychain, &size, path), @"Read keychain path");
  return [[NSString alloc] initWithBytes:path length:strlen(path) encoding:NSUTF8StringEncoding];
}
static NSArray *searchPaths(void) {
  CFArrayRef list = NULL; fixtureStatus(SecKeychainCopySearchList(&list), @"Read search list");
  NSMutableArray *paths = [NSMutableArray array];
  for (id object in (__bridge NSArray *)list) [paths addObject:keychainPath((__bridge SecKeychainRef)object)];
  CFRelease(list); return paths;
}
static SecKeychainRef openKeychain(NSString *path) {
  SecKeychainRef keychain = NULL; fixtureStatus(SecKeychainOpen(path.fileSystemRepresentation, &keychain), @"Open declared keychain");
  return keychain;
}
static void writeJSON(id value, NSString *path) {
  NSError *error = nil; NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:&error];
  fixtureRequire(data != nil && [data writeToFile:path options:NSDataWritingAtomic error:&error], @"Write fixture receipt");
}
static void restore(NSDictionary *state) {
  SecKeychainRef original = openKeychain(state[@"default"]);
  fixtureStatus(SecKeychainSetDefault(original), @"Restore original default"); CFRelease(original);
  NSMutableArray *list = [NSMutableArray array];
  for (NSString *path in state[@"search"]) { SecKeychainRef keychain = openKeychain(path); [list addObject:CFBridgingRelease(keychain)]; }
  fixtureStatus(SecKeychainSetSearchList((__bridge CFArrayRef)list), @"Restore original search list");
  fixtureRequire([searchPaths() isEqual:state[@"search"]], @"Original search list did not restore exactly");
  SecKeychainRef observed = NULL; fixtureStatus(SecKeychainCopyDefault(&observed), @"Read restored default");
  fixtureRequire([keychainPath(observed) isEqual:state[@"default"]], @"Original default did not restore exactly"); CFRelease(observed);
  if ([[NSFileManager defaultManager] fileExistsAtPath:state[@"fixture"]]) {
    SecKeychainRef fixture = openKeychain(state[@"fixture"]);
    fixtureStatus(SecKeychainDelete(fixture), @"Delete only owned fixture keychain"); CFRelease(fixture);
  }
}

int main(int argc, const char *argv[]) { @autoreleasepool {
  @try {
    NSDictionary *env = NSProcessInfo.processInfo.environment;
    fixtureRequire([env[@"GITHUB_ACTIONS"] isEqual:@"true"] && [env[@"RUNNER_OS"] isEqual:@"macOS"] && [env[@"GITHUB_REPOSITORY"] isEqual:@"surfacedby/OpenGEO"], @"This fixture is restricted to disposable OpenGEO GitHub Mac runners");
    fixtureRequire(argc == 3 || argc == 5, @"Expected setup directory old-app new-app, or cleanup directory");
    NSString *mode = @(argv[1]), *directory = [@(argv[2]) stringByResolvingSymlinksInPath];
    NSString *temporary = [env[@"RUNNER_TEMP"] stringByResolvingSymlinksInPath];
    fixtureRequire([directory hasPrefix:[temporary stringByAppendingString:@"/"]] && [[directory lastPathComponent] hasPrefix:@"release-macos-"], @"Fixture directory must be an owned release directory");
    NSString *stateFile = [directory stringByAppendingPathComponent:@"keychain-state.json"];
    if ([mode isEqual:@"cleanup"]) {
      NSDictionary *state = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:stateFile] options:0 error:nil];
      fixtureRequire([state[@"fixture"] isEqual:[directory stringByAppendingPathComponent:@"upgrade-fixture.keychain-db"]], @"Fixture cleanup scope changed");
      restore(state); writeJSON(@{@"originalDefaultAndSearchRestored":@YES, @"ownedKeychainRemoved":@YES}, [directory stringByAppendingPathComponent:@"keychain-cleanup.json"]);
      return 0;
    }
    fixtureRequire([mode isEqual:@"setup"] && argc == 5 && ![[NSFileManager defaultManager] fileExistsAtPath:stateFile], @"Never replace an existing fixture");
    SecKeychainRef original = NULL; fixtureStatus(SecKeychainCopyDefault(&original), @"Read original default");
    NSString *path = [directory stringByAppendingPathComponent:@"upgrade-fixture.keychain-db"];
    fixtureRequire(![[NSFileManager defaultManager] fileExistsAtPath:path], @"Fixture path already exists");
    NSDictionary *state = @{@"default":keychainPath(original), @"search":searchPaths(), @"fixture":path}; CFRelease(original);
    SecTrustedApplicationRef oldApp = NULL, newApp = NULL;
    fixtureStatus(SecTrustedApplicationCreateFromPath(argv[3], &oldApp), @"Bind old installer code");
    fixtureStatus(SecTrustedApplicationCreateFromPath(argv[4], &newApp), @"Bind new installer code");
    NSArray *trusted = @[CFBridgingRelease(oldApp), CFBridgingRelease(newApp)];
    SecAccessRef access = NULL; fixtureStatus(SecAccessCreate(CFSTR("OpenGEO Safe Storage"), (__bridge CFArrayRef)trusted, &access), @"Authorize only the two reviewed programs");
    unsigned char random[64]; fixtureStatus(SecRandomCopyBytes(kSecRandomDefault, sizeof(random), random), @"Create synthetic fixture entropy");
    NSData *password = [[[NSData dataWithBytes:random length:32] base64EncodedStringWithOptions:0] dataUsingEncoding:NSUTF8StringEncoding];
    NSData *secret = [[[NSData dataWithBytes:random + 32 length:32] base64EncodedStringWithOptions:0] dataUsingEncoding:NSUTF8StringEncoding];
    SecKeychainRef fixture = NULL; fixtureStatus(SecKeychainCreate(path.fileSystemRepresentation, (UInt32)password.length, password.bytes, false, NULL, &fixture), @"Create owned keychain");
    writeJSON(state, stateFile);
    @try {
      const char *service = "OpenGEO Safe Storage", *account = "OpenGEO";
      SecKeychainAttribute attributes[] = {{kSecServiceItemAttr, (UInt32)strlen(service), (void *)service}, {kSecAccountItemAttr, (UInt32)strlen(account), (void *)account}};
      SecKeychainAttributeList attributesList = {2, attributes}; SecKeychainItemRef item = NULL;
      fixtureStatus(SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &attributesList, (UInt32)secret.length, secret.bytes, fixture, access, &item), @"Create synthetic OS storage item");
      SecAccessRef actual = NULL; fixtureStatus(SecKeychainItemCopyAccess(item, &actual), @"Read actual item access");
      CFArrayRef acls = SecAccessCopyMatchingACLList(actual, kSecACLAuthorizationDecrypt);
      fixtureRequire(acls && CFArrayGetCount(acls) == 1, @"Expected one decrypt ACL");
      CFArrayRef applications = NULL; CFStringRef description = NULL; SecKeychainPromptSelector selector;
      fixtureStatus(SecACLCopyContents((SecACLRef)CFArrayGetValueAtIndex(acls, 0), &applications, &description, &selector), @"Read actual trusted programs");
      fixtureRequire(applications && CFArrayGetCount(applications) == 2, @"Never allow all applications or add another decrypt client");
      NSMutableSet *expectedPrograms = [NSMutableSet set], *observedPrograms = [NSMutableSet set];
      for (CFIndex index = 0; index < 2; index++) {
        CFDataRef expected = NULL, observed = NULL;
        fixtureStatus(SecTrustedApplicationCopyData((__bridge SecTrustedApplicationRef)trusted[index], &expected), @"Read expected code identity");
        fixtureStatus(SecTrustedApplicationCopyData((SecTrustedApplicationRef)CFArrayGetValueAtIndex(applications, index), &observed), @"Read installed code identity");
        [expectedPrograms addObject:CFBridgingRelease(expected)]; [observedPrograms addObject:CFBridgingRelease(observed)];
      }
      fixtureRequire(expectedPrograms.count == 2 && [expectedPrograms isEqual:observedPrograms], @"Trusted application identities changed");
      CFRelease(applications); if (description) CFRelease(description); CFRelease(acls); CFRelease(actual); CFRelease(item); CFRelease(access);
      fixtureStatus(SecKeychainSetDefault(fixture), @"Select owned fixture default");
      fixtureStatus(SecKeychainSetSearchList((__bridge CFArrayRef)@[(__bridge id)fixture]), @"Select only owned fixture search list");
      fixtureRequire([searchPaths() isEqual:@[path]], @"Fixture search list differs");
      writeJSON(@{@"syntheticItemOnly":@YES, @"trustedDecryptClients":@2, @"explicitFixtureOwnerConsent":@YES, @"realLoginKeychainUntouched":@YES,
        @"scope":@"Preauthorization of exact old and new code identities in one disposable keychain; not an automated system-dialog test"}, [directory stringByAppendingPathComponent:@"keychain-consent.json"]);
      CFRelease(fixture);
    } @catch (NSException *error) { restore(state); @throw error; }
    return 0;
  } @catch (NSException *error) { fprintf(stderr, "%s\n", error.reason.UTF8String); return 1; }
} }
