#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <Security/cssmerr.h>
#import <CommonCrypto/CommonDigest.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static void fixtureRequire(BOOL condition, NSString *message);
static void fixtureStatus(OSStatus status, NSString *operation);
static const char *fixtureServiceName = "OpenGEO Safe Storage";
// Electron's non-App-Store account suffix avoids its legacy-item migration,
// which creates a replacement item with only the first application's access.
static const char *fixtureAccountName = "OpenGEO Key";

static NSString *codePartition(NSString *path) {
  SecStaticCodeRef code = NULL; CFDictionaryRef info = NULL;
  fixtureStatus(SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:path], kSecCSDefaultFlags, &code), @"Read reviewed static code");
  fixtureStatus(SecStaticCodeCheckValidity(code, kSecCSStrictValidate, NULL), @"Validate reviewed static code");
  fixtureStatus(SecCodeCopySigningInformation(code, kSecCSSigningInformation, &info), @"Read reviewed code identity");
  NSData *hash = ((__bridge NSDictionary *)info)[(__bridge NSString *)kSecCodeInfoUnique];
  fixtureRequire([hash isKindOfClass:NSData.class] && hash.length == 20, @"Expected an actual 20-byte code directory hash");
  NSMutableString *value = [NSMutableString stringWithString:@"cdhash:"];
  for (NSUInteger index = 0; index < hash.length; index++) [value appendFormat:@"%02x", ((const unsigned char *)hash.bytes)[index]];
  CFRelease(info); CFRelease(code); return value;
}

static NSArray *itemPartitions(SecKeychainItemRef item) {
  SecAccessRef access = NULL; CFArrayRef acls = NULL;
  fixtureStatus(SecKeychainItemCopyAccess(item, &access), @"Read actual partition metadata");
  fixtureStatus(SecAccessCopyACLList(access, &acls), @"Enumerate actual item ACLs");
  NSArray *result = nil;
  NSMutableArray *observations = [NSMutableArray array];
  for (id object in (__bridge NSArray *)acls) {
    CFArrayRef clients = NULL; CFStringRef description = NULL; SecKeychainPromptSelector selector;
    OSStatus status = SecACLCopyContents((__bridge SecACLRef)object, &clients, &description, &selector);
    CFArrayRef authorizations = SecACLCopyAuthorizations((__bridge SecACLRef)object);
    NSMutableDictionary *observation = [@{@"contentsStatus":@((int)status), @"authorizations":(__bridge NSArray *)authorizations ?: @[], @"descriptionLength":@(description ? CFStringGetLength(description) : 0)} mutableCopy];
    if (status == errSecSuccess && description) {
      NSString *hex = (__bridge NSString *)description;
      if (hex.length && hex.length % 2 == 0 && [hex rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefABCDEF"] invertedSet]].location == NSNotFound) {
        NSMutableData *bytes = [NSMutableData dataWithLength:hex.length / 2];
        for (NSUInteger index = 0; index < hex.length; index += 2) {
          char pair[3] = {[hex characterAtIndex:index], [hex characterAtIndex:index + 1], 0};
          ((unsigned char *)bytes.mutableBytes)[index / 2] = (unsigned char)strtoul(pair, NULL, 16);
        }
        id plist = [NSPropertyListSerialization propertyListWithData:bytes options:NSPropertyListImmutable format:NULL error:nil];
        observation[@"decodedPropertyList"] = @([plist isKindOfClass:NSDictionary.class]);
        if ([plist isKindOfClass:NSDictionary.class] && plist[@"Partitions"]) {
          fixtureRequire(result == nil && [plist[@"Partitions"] isKindOfClass:NSArray.class], @"Unexpected or duplicate partition metadata");
          result = plist[@"Partitions"];
        }
      }
    }
    [observations addObject:observation];
    if (authorizations) CFRelease(authorizations);
    if (clients) CFRelease(clients); if (description) CFRelease(description);
  }
  // Only public ACL metadata is emitted. Passwords and item data are never read.
  NSData *diagnostic = [NSJSONSerialization dataWithJSONObject:@{@"aclMetadata":observations, @"partitions":result ?: @[]} options:0 error:nil];
  fixtureRequire(diagnostic && diagnostic.length < 16384, @"Bounded synthetic ACL metadata required");
  fprintf(stderr, "Fixture ACL metadata: %s\n", [[NSString alloc] initWithData:diagnostic encoding:NSUTF8StringEncoding].UTF8String);
  CFRelease(acls); CFRelease(access); return result ?: @[];
}

static void authorizePartitions(SecKeychainItemRef item, NSString *path, NSData *password, NSArray *partitions) {
  fixtureRequire([NSSet setWithArray:partitions].count == 2, @"Authorize exactly two distinct reviewed code hashes");
  // Keychain partition validation is separate from the legacy trusted-client ACL.
  // Supply this disposable keychain owner's consent to the system tool without
  // putting its random password in process arguments, the environment or a file.
  fixtureRequire([path rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./-"] invertedSet]].location == NSNotFound, @"Unexpected fixture command path");
  NSString *command = [NSString stringWithFormat:@"set-generic-password-partition-list -a \"%@\" -s \"%@\" -S %@ -k %@ %@\n", @(fixtureAccountName), @(fixtureServiceName), [partitions componentsJoinedByString:@","], [[NSString alloc] initWithData:password encoding:NSUTF8StringEncoding], path];
  NSTask *task = [NSTask new]; NSPipe *input = [NSPipe pipe], *output = [NSPipe pipe];
  task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/security"]; task.arguments = @[@"-i", @"-q"];
  NSMutableDictionary *environment = [NSMutableDictionary dictionary];
  for (NSString *name in @[@"PATH", @"HOME", @"TMPDIR", @"USER", @"LOGNAME"]) if (NSProcessInfo.processInfo.environment[name]) environment[name] = NSProcessInfo.processInfo.environment[name];
  task.environment = environment; task.standardInput = input; task.standardOutput = output; task.standardError = output;
  fixtureRequire([task launchAndReturnError:nil], @"Launch scoped system consent tool");
  [input.fileHandleForWriting writeData:[command dataUsingEncoding:NSUTF8StringEncoding]]; [input.fileHandleForWriting closeFile];
  NSData *diagnostic = [output.fileHandleForReading readDataToEndOfFile]; [task waitUntilExit];
  fixtureRequire(task.terminationStatus == 0 && diagnostic.length < 65536 && [diagnostic rangeOfData:password options:0 range:NSMakeRange(0, diagnostic.length)].location == NSNotFound, @"Scoped fixture consent failed; no diagnostic secrets are retained");
  fixtureRequire([[NSSet setWithArray:itemPartitions(item)] isEqual:[NSSet setWithArray:partitions]], @"Actual partition list must contain only the two reviewed builds");
}

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
static NSArray *searchPaths(SecPreferencesDomain domain) {
  CFArrayRef list = NULL; fixtureStatus(SecKeychainCopyDomainSearchList(domain, &list), @"Read declared domain search list");
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
static void validateFixtureState(NSDictionary *state) {
  NSString *directory = state[@"ownerDirectory"], *path = state[@"fixture"], *base = state[@"fixtureBase"];
  NSString *home = [[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Keychains"] stringByResolvingSymlinksInPath];
  NSString *prefix = [@"opengeo-" stringByAppendingFormat:@"%@-", directory.lastPathComponent];
  fixtureRequire([base.stringByDeletingLastPathComponent isEqual:home] && [base.lastPathComponent hasPrefix:prefix] && [base hasSuffix:@".keychain"], @"Only the uniquely owned user Keychain may be addressed");
  NSString *uuid = [base.lastPathComponent substringWithRange:NSMakeRange(prefix.length, base.lastPathComponent.length - prefix.length - @".keychain".length)];
  fixtureRequire([[NSUUID alloc] initWithUUIDString:uuid] && [path isEqual:[base stringByAppendingString:@"-db"]], @"Expected the owned protected-format Keychain identity");
}

static void restore(NSDictionary *state) {
  validateFixtureState(state);
  SecKeychainRef original = openKeychain(state[@"default"]);
  fixtureStatus(SecKeychainSetDefault(original), @"Restore original default"); CFRelease(original);
  NSMutableArray *list = [NSMutableArray array];
  for (NSString *path in state[@"search"]) { SecKeychainRef keychain = openKeychain(path); [list addObject:CFBridgingRelease(keychain)]; }
  fixtureStatus(SecKeychainSetDomainSearchList(kSecPreferencesDomainUser, (__bridge CFArrayRef)list), @"Restore original user search list");
  fixtureRequire([searchPaths(kSecPreferencesDomainUser) isEqual:state[@"search"]], @"Original user search list did not restore exactly");
  fixtureRequire([searchPaths(kSecPreferencesDomainSystem) isEqual:state[@"systemSearch"]] && [searchPaths(kSecPreferencesDomainDynamic) isEqual:state[@"dynamicSearch"]], @"System or dynamic keychains changed");
  SecKeychainRef observed = NULL; fixtureStatus(SecKeychainCopyDefault(&observed), @"Read restored default");
  fixtureRequire([keychainPath(observed) isEqual:state[@"default"]], @"Original default did not restore exactly"); CFRelease(observed);
  for (NSString *path in @[state[@"fixture"], state[@"fixtureBase"]]) {
    if ([[NSFileManager defaultManager] fileExistsAtPath:path]) {
      SecKeychainRef fixture = openKeychain(path);
      fixtureStatus(SecKeychainDelete(fixture), @"Delete only owned fixture keychain"); CFRelease(fixture);
    }
  }
  fixtureRequire(![[NSFileManager defaultManager] fileExistsAtPath:state[@"fixture"]] && ![[NSFileManager defaultManager] fileExistsAtPath:state[@"fixtureBase"]], @"Owned Keychain files remain after cleanup");
}

static void inspectFixture(NSDictionary *state, const char *first, const char *second, const char *pidText) {
  validateFixtureState(state);
  fixtureStatus(SecKeychainSetUserInteractionAllowed(false), @"Disable UI for read-only fixture observations");
  SecKeychainRef fixture = openKeychain(state[@"fixture"]);
  const char *service = fixtureServiceName, *account = fixtureAccountName;
  SecKeychainAttribute attributes[] = {{kSecServiceItemAttr, (UInt32)strlen(service), (void *)service}, {kSecAccountItemAttr, (UInt32)strlen(account), (void *)account}};
  SecKeychainAttributeList list = {2, attributes}; SecKeychainSearchRef search = NULL; SecKeychainItemRef item = NULL;
  fixtureStatus(SecKeychainSearchCreateFromAttributes(fixture, kSecGenericPasswordItemClass, &list, &search), @"Find owned item metadata for observation");
  OSStatus found = SecKeychainSearchCopyNext(search, &item); CFRelease(search);
  NSMutableDictionary *record = [@{@"itemStatus":@((int)found), @"firstStaticCode":codePartition(@(first)), @"secondStaticCode":codePartition(@(second))} mutableCopy];
  SecKeychainStatus keychainStatus = 0;
  fixtureStatus(SecKeychainGetStatus(fixture, &keychainStatus), @"Observe owned Keychain lock state");
  record[@"keychainUnlocked"] = @((keychainStatus & kSecUnlockStateStatus) != 0);
  // Compare metadata APIs without asking for any secret or allowing UI. Only
  // this disposable Keychain is searched, including items created by the probe.
  CFTypeRef metadata = NULL;
  NSDictionary *query = @{(__bridge NSString *)kSecClass:(__bridge NSString *)kSecClassGenericPassword,
    (__bridge NSString *)kSecMatchSearchList:@[(__bridge id)fixture],
    (__bridge NSString *)kSecMatchLimit:(__bridge NSString *)kSecMatchLimitAll,
    (__bridge NSString *)kSecReturnAttributes:@YES,
    (__bridge NSString *)kSecUseAuthenticationUI:(__bridge NSString *)kSecUseAuthenticationUIFail};
  OSStatus metadataStatus = SecItemCopyMatching((__bridge CFDictionaryRef)query, &metadata);
  record[@"genericMetadataStatus"] = @((int)metadataStatus);
  if (metadataStatus == errSecSuccess) {
    fixtureRequire(metadata && CFGetTypeID(metadata) == CFArrayGetTypeID() && CFArrayGetCount(metadata) <= 8, @"Bounded owned-item metadata required");
    NSMutableArray *rows = [NSMutableArray array];
    for (NSDictionary *row in (__bridge NSArray *)metadata) {
      NSString *serviceName = row[(__bridge NSString *)kSecAttrService], *accountName = row[(__bridge NSString *)kSecAttrAccount];
      fixtureRequire([serviceName isKindOfClass:NSString.class] && serviceName.length < 128 && [accountName isKindOfClass:NSString.class] && accountName.length < 128, @"Expected bounded synthetic item names");
      [rows addObject:@{@"service":serviceName, @"account":accountName}];
    }
    record[@"genericItems"] = rows;
  }
  if (metadata) CFRelease(metadata);
  if (found == errSecSuccess) {
    record[@"partitions"] = itemPartitions(item);
    SecAccessRef access = NULL; fixtureStatus(SecKeychainItemCopyAccess(item, &access), @"Read owned decrypt ACL metadata");
    CFArrayRef acls = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt);
    NSMutableArray *clientHashes = [NSMutableArray array];
    for (id object in (__bridge NSArray *)acls) {
      CFArrayRef applications = NULL; CFStringRef description = NULL; SecKeychainPromptSelector selector;
      fixtureStatus(SecACLCopyContents((__bridge SecACLRef)object, &applications, &description, &selector), @"Observe actual trusted-client metadata");
      for (id client in (__bridge NSArray *)applications) {
        CFDataRef data = NULL; fixtureStatus(SecTrustedApplicationCopyData((__bridge SecTrustedApplicationRef)client, &data), @"Read opaque trusted-client metadata");
        unsigned char hash[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(CFDataGetBytePtr(data), (CC_LONG)CFDataGetLength(data), hash); CFRelease(data);
        NSMutableString *value = [NSMutableString string];
        for (NSUInteger index = 0; index < sizeof(hash); index++) [value appendFormat:@"%02x", hash[index]];
        [clientHashes addObject:value];
      }
      if (applications) CFRelease(applications); if (description) CFRelease(description);
    }
    record[@"trustedClientDataSha256"] = [clientHashes sortedArrayUsingSelector:@selector(compare:)];
    if (acls) CFRelease(acls); CFRelease(access); CFRelease(item);
  }
  if (pidText) {
    char *end = NULL; long pid = strtol(pidText, &end, 10);
    fixtureRequire(end && !*end && pid > 0 && pid <= INT_MAX, @"Expected an owned child PID");
    SecCodeRef code = NULL;
    OSStatus status = SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)@{(__bridge NSString *)kSecGuestAttributePid:@(pid)}, kSecCSDefaultFlags, &code);
    record[@"processLookupStatus"] = @((int)status);
    if (status == errSecSuccess) {
      record[@"processValidityStatus"] = @((int)SecCodeCheckValidity(code, kSecCSDefaultFlags, NULL));
      CFDictionaryRef info = NULL; status = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &info);
      record[@"processSigningStatus"] = @((int)status);
      if (status == errSecSuccess) {
        NSData *hash = ((__bridge NSDictionary *)info)[(__bridge NSString *)kSecCodeInfoUnique];
        if ([hash isKindOfClass:NSData.class] && hash.length == 20) {
          NSMutableString *value = [NSMutableString stringWithString:@"cdhash:"];
          for (NSUInteger index = 0; index < hash.length; index++) [value appendFormat:@"%02x", ((const unsigned char *)hash.bytes)[index]];
          record[@"processCode"] = value;
        }
        CFRelease(info);
      }
      CFRelease(code);
    }
  }
  CFRelease(fixture);
  NSData *json = [NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
  fixtureRequire(json && json.length < 16384, @"Bounded read-only code and ACL observations required");
  printf("%s\n", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
}

int main(int argc, const char *argv[]) { @autoreleasepool {
  @try {
    NSDictionary *env = NSProcessInfo.processInfo.environment;
    fixtureRequire([env[@"GITHUB_ACTIONS"] isEqual:@"true"] && [env[@"RUNNER_OS"] isEqual:@"macOS"] && [env[@"GITHUB_REPOSITORY"] isEqual:@"surfacedby/OpenGEO"], @"This fixture is restricted to disposable OpenGEO GitHub Mac runners");
    fixtureRequire(argc == 3 || argc == 5 || argc == 6, @"Expected setup/inspect directory old-app new-app [pid], or cleanup directory");
    NSString *mode = @(argv[1]), *directory = [@(argv[2]) stringByResolvingSymlinksInPath];
    NSString *temporary = [env[@"RUNNER_TEMP"] stringByResolvingSymlinksInPath];
    fixtureRequire([directory hasPrefix:[temporary stringByAppendingString:@"/"]] && [[directory lastPathComponent] hasPrefix:@"release-macos-"], @"Fixture directory must be an owned release directory");
    NSString *stateFile = [directory stringByAppendingPathComponent:@"keychain-state.json"];
    if ([mode isEqual:@"inspect"]) {
      fixtureRequire(argc == 5 || argc == 6, @"Read-only inspection requires the reviewed app paths");
      NSDictionary *state = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:stateFile] options:0 error:nil];
      fixtureRequire([state[@"ownerDirectory"] isEqual:directory], @"Fixture observation scope changed");
      inspectFixture(state, argv[3], argv[4], argc == 6 ? argv[5] : NULL);
      return 0;
    }
    if ([mode isEqual:@"cleanup"]) {
      NSDictionary *state = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:stateFile] options:0 error:nil];
      fixtureRequire([state[@"ownerDirectory"] isEqual:directory], @"Fixture cleanup scope changed");
      restore(state); writeJSON(@{@"originalDefaultAndSearchRestored":@YES, @"ownedKeychainRemoved":@YES}, [directory stringByAppendingPathComponent:@"keychain-cleanup.json"]);
      return 0;
    }
    fixtureRequire([mode isEqual:@"setup"] && argc == 5 && ![[NSFileManager defaultManager] fileExistsAtPath:stateFile], @"Never replace an existing fixture");
    SecPreferencesDomain domain; fixtureStatus(SecKeychainGetPreferenceDomain(&domain), @"Read active preference domain");
    fixtureRequire(domain == kSecPreferencesDomainUser, @"Only the disposable runner's user domain is authorized");
    SecKeychainRef original = NULL; fixtureStatus(SecKeychainCopyDefault(&original), @"Read original default");
    // macOS enables partition protection only for user Keychains in this home.
    // A temporary-directory Keychain silently uses the legacy, unpartitioned format.
    NSString *home = [[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Keychains"] stringByResolvingSymlinksInPath];
    NSString *base = [home stringByAppendingPathComponent:[NSString stringWithFormat:@"opengeo-%@-%@.keychain", directory.lastPathComponent, NSUUID.UUID.UUIDString]];
    NSString *path = [base stringByAppendingString:@"-db"];
    fixtureRequire(![[NSFileManager defaultManager] fileExistsAtPath:path] && ![[NSFileManager defaultManager] fileExistsAtPath:base], @"Fixture path already exists");
    NSDictionary *state = @{@"default":keychainPath(original), @"search":searchPaths(kSecPreferencesDomainUser), @"systemSearch":searchPaths(kSecPreferencesDomainSystem), @"dynamicSearch":searchPaths(kSecPreferencesDomainDynamic), @"fixture":path, @"fixtureBase":base, @"ownerDirectory":directory}; CFRelease(original);
    validateFixtureState(state);
    SecTrustedApplicationRef oldApp = NULL, newApp = NULL;
    fixtureStatus(SecTrustedApplicationCreateFromPath(argv[3], &oldApp), @"Bind old installer code");
    fixtureStatus(SecTrustedApplicationCreateFromPath(argv[4], &newApp), @"Bind new installer code");
    NSArray *trusted = @[CFBridgingRelease(oldApp), CFBridgingRelease(newApp)];
    SecAccessRef access = NULL; fixtureStatus(SecAccessCreate(CFSTR("OpenGEO Safe Storage"), (__bridge CFArrayRef)trusted, &access), @"Authorize only the two reviewed programs");
    unsigned char random[64]; fixtureStatus(SecRandomCopyBytes(kSecRandomDefault, sizeof(random), random), @"Create synthetic fixture entropy");
    NSData *password = [[[NSData dataWithBytes:random length:32] base64EncodedStringWithOptions:0] dataUsingEncoding:NSUTF8StringEncoding];
    NSData *secret = [[[NSData dataWithBytes:random + 32 length:32] base64EncodedStringWithOptions:0] dataUsingEncoding:NSUTF8StringEncoding];
    SecKeychainRef fixture = NULL;
    writeJSON(state, stateFile);
    @try {
      fixtureStatus(SecKeychainCreate(base.fileSystemRepresentation, (UInt32)password.length, password.bytes, false, NULL, &fixture), @"Create owned user Keychain");
      fixtureRequire([keychainPath(fixture) isEqual:path], @"Creation must use the protected user Keychain format");
      const char *service = fixtureServiceName, *account = fixtureAccountName;
      SecKeychainAttribute attributes[] = {{kSecServiceItemAttr, (UInt32)strlen(service), (void *)service}, {kSecAccountItemAttr, (UInt32)strlen(account), (void *)account}};
      SecKeychainAttributeList attributesList = {2, attributes}; SecKeychainItemRef item = NULL;
      fixtureStatus(SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &attributesList, (UInt32)secret.length, secret.bytes, fixture, access, &item), @"Create synthetic OS storage item");
      NSArray *partitionsBefore = itemPartitions(item), *partitions = @[codePartition(@(argv[3])), codePartition(@(argv[4]))];
      fixtureRequire(partitionsBefore.count == 1, @"A genuine initial OS partition entry is required before consent");
      authorizePartitions(item, path, password, partitions);
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
      fixtureStatus(SecKeychainSetUserInteractionAllowed(false), @"Disable UI only for this fixture controller's negative check");
      UInt32 deniedLength = 0; void *deniedBytes = NULL;
      OSStatus denied = SecKeychainFindGenericPassword(fixture, (UInt32)strlen(service), service, (UInt32)strlen(account), account, &deniedLength, &deniedBytes, NULL);
      if (deniedBytes) SecKeychainItemFreeContent(NULL, deniedBytes);
      fixtureRequire(denied == errSecAuthFailed || denied == errSecInteractionNotAllowed || denied == CSSMERR_CSP_OPERATION_AUTH_DENIED, @"An unlisted program must be refused, not merely miss the item");
      fixtureStatus(SecKeychainSetUserInteractionAllowed(true), @"Restore fixture controller interaction");
      fixtureStatus(SecKeychainSetDefault(fixture), @"Select owned fixture default");
      // The combined API also returns system and dynamic keychains, which are
      // outside this fixture's authority. Replace and verify only the user list.
      fixtureStatus(SecKeychainSetDomainSearchList(kSecPreferencesDomainUser, (__bridge CFArrayRef)@[(__bridge id)fixture]), @"Select only owned fixture user search list");
      fixtureRequire([searchPaths(kSecPreferencesDomainUser) isEqual:@[path]], @"Fixture user search list differs");
      fixtureRequire([searchPaths(kSecPreferencesDomainSystem) isEqual:state[@"systemSearch"]] && [searchPaths(kSecPreferencesDomainDynamic) isEqual:state[@"dynamicSearch"]], @"System or dynamic keychains changed");
      writeJSON(@{@"syntheticItemOnly":@YES, @"trustedDecryptClients":@2, @"explicitFixtureOwnerConsent":@YES, @"realLoginKeychainUntouched":@YES,
        @"protectedKeychainFormat":@YES, @"partitionCodeIdentities":partitions, @"partitionMetadataBefore":partitionsBefore, @"unlistedClientDenied":@YES,
        @"scope":@"Preauthorization of exact old and new code identities in one disposable keychain; not an automated system-dialog test"}, [directory stringByAppendingPathComponent:@"keychain-consent.json"]);
      CFRelease(fixture);
    } @catch (NSException *error) { restore(state); @throw error; }
    return 0;
  } @catch (NSException *error) { fprintf(stderr, "%s\n", error.reason.UTF8String); return 1; }
} }
