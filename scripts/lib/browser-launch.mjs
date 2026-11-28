/** SQLite requires an enabled WASM compiler; set that prerequisite explicitly in Firefox automation. */
export function browserLaunchOptions(name) {
  return name === 'firefox'
    ? {
        firefoxUserPrefs: {
          'javascript.options.wasm_baselinejit': true,
          'javascript.options.wasm_optimizingjit': true,
        },
      }
    : {};
}
