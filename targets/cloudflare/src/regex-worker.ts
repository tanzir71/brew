import variant from '@jitl/quickjs-wasmfile-release-sync';
import type { QuickJSSyncVariant } from '@jitl/quickjs-ffi-types';
import wasmModule from '@jitl/quickjs-wasmfile-release-sync/wasm';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import { CloudflareRegex, regexWasmMemory } from './regex.js';

// Wrangler uploads the precompiled module. Workers must not compile fetched
// bytes or rely on Node filesystem loading at request time.
let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
// The package's CJS declarations and ESM export describe different default shapes.
function syncExport(value: QuickJSSyncVariant | { default: QuickJSSyncVariant }) {
  return 'default' in value ? value.default : value;
}
const syncVariant = syncExport(variant);
export const loadRegexEngine = () =>
  (engine ??= newQuickJSWASMModuleFromVariant(
    newVariant(syncVariant, { wasmModule, wasmMemory: regexWasmMemory() }),
  ));
export const cloudflareRegex = new CloudflareRegex(loadRegexEngine);
