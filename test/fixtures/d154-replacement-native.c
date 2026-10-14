/* Self-authored hostile TEST fixture, MIT. No Adapter implementation here.
 * A real dlopen control must execute this constructor before race negatives
 * count as evidence; invalid binary bytes cannot prove non-execution. */
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>

NAPI_MODULE_INIT() {
  const char *marker = getenv("SOURCE_ATOMIC_ATTACK_MARKER");
  if (marker) {
    FILE *file = fopen(marker, "ab");
    if (file) { fputs("UNTRUSTED_NATIVE_EXECUTED\n", file); fclose(file); }
  }
  napi_value value;
  napi_get_boolean(env, 1, &value);
  napi_set_named_property(env, exports, "foreignCodeExecuted", value);
  return exports;
}
