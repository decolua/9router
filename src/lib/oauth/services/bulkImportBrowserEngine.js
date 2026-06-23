/**
 * Browser Engine Manager for Bulk Import
 * 
 * Centralizes browser launcher logic for Chromium (Playwright) and Camoufox (stealth Firefox).
 * Uses dynamic import() with variables so webpack does NOT try to resolve at build time.
 * Falls back to install-only helper if dependencies are missing.
 */

import logger from "@/lib/logger";

/**
 * Dynamically import a package. Uses a variable so webpack/bundler does not
 * try to resolve the import at build time (which would fail if the package
 * is not installed).
 * @param {string} packageName - Package to import
 * @returns {Promise<any>}
 */
async function dynamicImport(packageName) {
  // Webpack magic comment to ignore dynamic imports
  // This is intentional - browser engines are optional dependencies loaded at runtime
  const pkg = packageName;
  return import(/* webpackIgnore: true */ pkg);
}

/**
 * Load a runtime helper module from the CLI hooks directory.
 * These helpers provide install-only functionality when main packages are missing.
 * @param {string} helperName - Name of the helper module
 * @returns {any|null}
 */
function loadRuntimeHelper(helperName) {
  try {
    // Use eval to hide dynamic require from webpack's static analyzer,
    // preventing "Critical dependency" warning.
    const helperPath = `../../../cli/hooks/${helperName}.js`;
    const dynamicRequire = eval('require');
    return dynamicRequire(helperPath);
  } catch {
    return null;
  }
}

/**
 * Launch Camoufox (stealth Firefox browser)
 * @param {object} options - Launch options
 * @param {boolean} options.headless - Run in headless mode
 * @param {string|null} options.proxy - Proxy URL (e.g., "http://user:pass@host:port")
 * @returns {Promise<any>} Browser instance
 */
async function launchCamoufox({ headless = false, proxy }) {
  let camoufox;
  
  try {
    camoufox = await dynamicImport('camoufox-js');
  } catch (firstErr) {
    logger.warn("BULK_IMPORT", "Camoufox not installed, attempting runtime helper install", {
      error: firstErr.message
    });
    
    const runtime = loadRuntimeHelper('camoufoxRuntime');
    if (!runtime?.installCamoufoxOnly) {
      const err = new Error(
        `Camoufox not installed and runtime helper unavailable. Run "npm install -g camoufox-js"`
      );
      err.code = 'CAMOUFOX_PACKAGE_MISSING';
      throw err;
    }
    
    const installed = runtime.installCamoufoxOnly({ silent: false });
    if (!installed.ok) {
      const err = new Error(`Camoufox installation failed: ${installed.error || 'unknown error'}`);
      err.code = 'CAMOUFOX_INSTALL_FAILED';
      throw err;
    }
    
    camoufox = await dynamicImport('camoufox-js');
  }
  
  if (!camoufox?.launch) {
    throw new Error('Camoufox imported but launch API not available.');
  }
  
  const launchOptions = { headless };
  if (proxy) {
    launchOptions.proxy = { server: proxy };
  }
  
  return camoufox.launch(launchOptions);
}

/**
 * Launch Chromium using Playwright
 * @param {object} options - Launch options
 * @param {boolean} options.headless - Run in headless mode
 * @param {string|null} options.proxy - Proxy URL
 * @returns {Promise<any>} Browser instance
 */
async function launchChromium({ headless = false, proxy }) {
  let playwright;
  
  try {
    playwright = await dynamicImport('playwright');
  } catch (err) {
    logger.error("BULK_IMPORT", "Playwright not installed", { error: err.message });
    const error = new Error(
      `Playwright not installed. Run "npm install playwright" or "npm install -g playwright"`
    );
    error.code = 'PLAYWRIGHT_PACKAGE_MISSING';
    throw error;
  }
  
  if (!playwright?.chromium?.launch) {
    throw new Error('Playwright imported but chromium.launch API not available.');
  }
  
  const launchOptions = { 
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
    ]
  };
  
  if (proxy) {
    launchOptions.proxy = { server: proxy };
  }
  
  return playwright.chromium.launch(launchOptions);
}

/**
 * Launch browser using specified engine
 * @param {string} engine - Browser engine ('chromium' or 'camoufox')
 * @param {object} options - Launch options
 * @param {boolean} options.headless - Run in headless mode
 * @param {string|null} options.proxy - Proxy URL
 * @returns {Promise<any>} Browser instance
 */
export async function launchBrowser(engine = 'chromium', options = {}) {
  logger.info("BULK_IMPORT", `Launching browser with engine: ${engine}`, { 
    headless: options.headless,
    hasProxy: !!options.proxy 
  });
  
  try {
    if (engine === 'camoufox') {
      return await launchCamoufox(options);
    }
    return await launchChromium(options);
  } catch (error) {
    logger.error("BULK_IMPORT", `Failed to launch browser with engine: ${engine}`, {
      error: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Create a structured error object for browser launch failures
 * @param {Error|string} error - Original error
 * @param {string} engine - Browser engine that failed
 * @returns {object} Structured error
 */
export function createEngineError(error, engine = 'chromium') {
  const msg = typeof error === 'string' ? error : error?.message || String(error);
  
  return {
    error: msg,
    engine,
    actionable: true,
    suggestion: engine === 'camoufox' 
      ? 'Try using chromium engine or install camoufox-js globally'
      : 'Install playwright: npm install playwright'
  };
}

export default launchBrowser;
