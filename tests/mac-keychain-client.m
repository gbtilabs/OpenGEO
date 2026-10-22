#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <Security/cssmerr.h>
#import <CommonCrypto/CommonDigest.h>
#include <stdio.h>
#include <string.h>

// These independently signed clients exercise OS permissions, not application business logic.
int main(int argc, const char *argv[]) { @autoreleasepool {
  NSDictionary *environment = NSProcessInfo.processInfo.environment;
  if (argc != 2 || ![environment[@"GITHUB_ACTIONS"] isEqual:@"true"] || ![environment[@"RUNNER_OS"] isEqual:@"macOS"] || ![environment[@"GITHUB_REPOSITORY"] isEqual:@"surfacedby/OpenGEO"]) return 78;
  NSString *directory = [@(argv[1]) stringByResolvingSymlinksInPath];
  NSString *temporary = [environment[@"RUNNER_TEMP"] stringByResolvingSymlinksInPath];
  if (![directory hasPrefix:[temporary stringByAppendingString:@"/release-macos-unit-"]]) return 78;
  NSDictionary *state = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:@"keychain-state.json"]] options:0 error:nil];
  NSString *path = state[@"fixture"], *base = state[@"fixtureBase"];
  NSString *home = [[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Keychains"] stringByResolvingSymlinksInPath];
  NSString *prefix = [@"opengeo-" stringByAppendingFormat:@"%@-", directory.lastPathComponent];
  if (![state[@"ownerDirectory"] isEqual:directory] || ![base.stringByDeletingLastPathComponent isEqual:home] || ![base.lastPathComponent hasPrefix:prefix] || ![base hasSuffix:@".keychain"] || ![path isEqual:[base stringByAppendingString:@"-db"]]) return 78;
  NSString *uuid = [base.lastPathComponent substringWithRange:NSMakeRange(prefix.length, base.lastPathComponent.length - prefix.length - @".keychain".length)];
  if (![[NSUUID alloc] initWithUUIDString:uuid]) return 78;
  if (SecKeychainSetUserInteractionAllowed(false) != errSecSuccess) return 78;
  SecKeychainRef keychain = NULL; OSStatus status = SecKeychainOpen(path.fileSystemRepresentation, &keychain);
  if (status != errSecSuccess) return 78;
  UInt32 size = 0; void *bytes = NULL;
#if defined(CLIENT_API_V2)
  // Chromium queries through SecItem with the process's configured search list.
  CFTypeRef result = NULL;
  NSDictionary *query = @{(__bridge NSString *)kSecClass:(__bridge NSString *)kSecClassGenericPassword,
    (__bridge NSString *)kSecAttrService:@"OpenGEO Safe Storage", (__bridge NSString *)kSecAttrAccount:@"OpenGEO Key",
    (__bridge NSString *)kSecMatchLimit:(__bridge NSString *)kSecMatchLimitOne,
    (__bridge NSString *)kSecReturnData:@YES, (__bridge NSString *)kSecReturnAttributes:@YES};
  status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status == errSecSuccess) {
    CFDataRef data = result && CFGetTypeID(result) == CFDictionaryGetTypeID() ? CFDictionaryGetValue((CFDictionaryRef)result, kSecValueData) : NULL;
    if (!data || CFGetTypeID(data) != CFDataGetTypeID()) status = errSecDecode;
    else { size = (UInt32)CFDataGetLength(data); bytes = (void *)CFDataGetBytePtr(data); }
  }
#else
  const char *service = "OpenGEO Safe Storage", *account = "OpenGEO Key";
  status = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(service), service, (UInt32)strlen(account), account, &size, &bytes, NULL);
#endif
  if (status == errSecSuccess) {
    unsigned char hash[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(bytes, size, hash);
    printf("{\"client\":%d,\"status\":0,\"secretSha256\":\"", CLIENT_ID);
    for (NSUInteger index = 0; index < sizeof(hash); index++) printf("%02x", hash[index]);
    printf("\"}\n");
  } else printf("{\"client\":%d,\"status\":%d}\n", CLIENT_ID, (int)status);
#if defined(CLIENT_API_V2)
  if (result) CFRelease(result);
#else
  if (bytes) SecKeychainItemFreeContent(NULL, bytes);
#endif
  CFRelease(keychain);
  if (status == errSecSuccess) return 0;
  return status == errSecAuthFailed || status == errSecInteractionNotAllowed || status == CSSMERR_CSP_OPERATION_AUTH_DENIED ? 77 : 78;
} }
