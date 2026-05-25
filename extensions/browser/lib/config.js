/** @typedef {{ apiBaseUrl: string; webBaseUrl: string; userId: string }} SpExtensionConfig */

/** @type {SpExtensionConfig} */
const SP_DEFAULT_CONFIG = {
  apiBaseUrl: "http://127.0.0.1:8787",
  webBaseUrl: "http://127.0.0.1:3000",
  userId: ""
};

const SP_STORAGE_KEYS = {
  apiBaseUrl: "sp_api_base_url",
  webBaseUrl: "sp_web_base_url",
  userId: "sp_user_id"
};

/**
 * @param {Partial<SpExtensionConfig>} overrides
 * @returns {SpExtensionConfig}
 */
function spMergeConfig(overrides) {
  return {
    apiBaseUrl: overrides.apiBaseUrl || SP_DEFAULT_CONFIG.apiBaseUrl,
    webBaseUrl: overrides.webBaseUrl || SP_DEFAULT_CONFIG.webBaseUrl,
    userId: overrides.userId || SP_DEFAULT_CONFIG.userId
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.SP_DEFAULT_CONFIG = SP_DEFAULT_CONFIG;
  globalThis.SP_STORAGE_KEYS = SP_STORAGE_KEYS;
  globalThis.spMergeConfig = spMergeConfig;
}
