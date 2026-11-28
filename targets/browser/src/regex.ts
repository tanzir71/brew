import variant from '@jitl/quickjs-wasmfile-release-sync';
import type { QuickJSSyncVariant } from '@jitl/quickjs-ffi-types';
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import {
  InterruptibleRegex,
  regexWasmMemory,
} from '../../../packages/core/src/interruptible-regex.js';

let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
export const browserRegex = new InterruptibleRegex(
  () =>
    (engine ??= (async () => {
      const response = await fetch(wasmUrl, { credentials: 'omit' });
      if (!response.ok) throw new Error('Regular expression engine could not start.');
      const wasmModule = await WebAssembly.compile(await response.arrayBuffer());
      const sync = syncExport(variant);
      return newQuickJSWASMModuleFromVariant(
        newVariant(sync, { wasmModule, wasmMemory: regexWasmMemory() }),
      );
    })()),
);
function syncExport(value: QuickJSSyncVariant | { default: QuickJSSyncVariant }) {
  return 'default' in value ? value.default : value;
}
