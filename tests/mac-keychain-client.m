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
  NSString *path = [@(argv[1]) stringByResolvingSymlinksInPath];
  NSString *temporary = [environment[@"RUNNER_TEMP"] stringByResolvingSymlinksInPath];
  if (![path hasPrefix:[temporary stringByAppendingString:@"/release-macos-unit-"]] || ![path.lastPathComponent isEqual:@"upgrade-fixture.keychain-db"]) return 78;
  if (SecKeychainSetUserInteractionAllowed(false) != errSecSuccess) return 78;
  SecKeychainRef keychain = NULL; OSStatus status = SecKeychainOpen(path.fileSystemRepresentation, &keychain);
  if (status != errSecSuccess) return 78;
  const char *service = "OpenGEO Safe Storage", *account = "OpenGEO";
  UInt32 size = 0; void *bytes = NULL;
  status = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(service), service, (UInt32)strlen(account), account, &size, &bytes, NULL);
  if (status == errSecSuccess) {
    unsigned char hash[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(bytes, size, hash);
    printf("{\"client\":%d,\"status\":0,\"secretSha256\":\"", CLIENT_ID);
    for (NSUInteger index = 0; index < sizeof(hash); index++) printf("%02x", hash[index]);
    printf("\"}\n");
  } else printf("{\"client\":%d,\"status\":%d}\n", CLIENT_ID, (int)status);
  if (bytes) SecKeychainItemFreeContent(NULL, bytes); CFRelease(keychain);
  if (status == errSecSuccess) return 0;
  return status == errSecAuthFailed || status == errSecInteractionNotAllowed || status == CSSMERR_CSP_OPERATION_AUTH_DENIED ? 77 : 78;
} }
