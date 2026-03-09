const { selectMenu } = require("./input");

/**
 * Show a menu with back button at top and handle selection
 * @param {Object} config - Menu configuration
 * @param {string} config.title - Menu title
 * @param {string} config.headerContent - Optional header content
 * @param {Array<{label: string, action: Function}>} config.items - Menu items with actions
 * @param {string} config.backLabel - Back button label (default: "← Back")
 * @param {number} config.defaultIndex - Default selected index (default: 0)
 * @param {Function} config.refresh - Optional refresh function to call after each action
 * @param {Array<string>} config.breadcrumb - Optional breadcrumb path
 * @returns {Promise<void>}
 */
async function showMenuWithBack(config) {
  const {
    title,
    headerContent = "",
    items,
    backLabel = "← Back",
    defaultIndex = 0,
    refresh = null,
    breadcrumb = []
  } = config;

  while (true) {
    // Call refresh if provided
    let refreshedData = null;
    if (refresh) {
      refreshedData = await refresh();
      if (refreshedData === null) {
        // Refresh failed, exit menu
        return;
      }
    }

    // Build menu items with back at top
    const menuItems = [
      { label: backLabel, icon: "☆" },
      ...items.map(item => ({
        label: typeof item.label === "function" ? item.label(refreshedData) : item.label,
        icon: "☆"
      }))
    ];

    // Resolve headerContent if it's a function
    const resolvedHeader = typeof headerContent === "function" 
      ? await headerContent(refreshedData) 
      : headerContent;

    const selected = await selectMenu(
      title,
      menuItems,
      defaultIndex,
      "",
      resolvedHeader,
      breadcrumb
    );

    // Back or ESC
    if (selected === -1 || selected === 0) {
      return;
    }

    // Execute action for selected item
    const actionIndex = selected - 1;
    const item = items[actionIndex];
    
    if (item && item.action) {
      const shouldContinue = await item.action(refreshedData);
      // If action returns false, exit menu
      if (shouldContinue === false) {
        return;
      }
    }
  }
}

/**
 * Show a list menu where items are fetched dynamically
 * @param {Object} config - Menu configuration
 * @param {string} config.title - Menu title
 * @param {string} config.headerContent - Optional header content
 * @param {Function} config.fetchItems - Async function to fetch items array
 * @param {Function} config.formatItem - Function to format each item to {label, data}
 * @param {Function} config.onSelect - Action when item is selected
 * @param {Object} config.createAction - Optional create action {label, action}
 * @param {string} config.backLabel - Back button label
 * @param {Array<string>} config.breadcrumb - Optional breadcrumb path
 * @returns {Promise<void>}
 */
async function showListMenu(config) {
  const {
    title,
    headerContent = "",
    fetchItems,
    formatItem,
    onSelect,
    createAction = null,
    backLabel = "← Back",
    breadcrumb = []
  } = config;

  while (true) {
    // Fetch items
    const result = await fetchItems();
    if (!result) {
      return;
    }

    const items = result.items || [];
    const metadata = result.metadata || {};

    // Build menu items
    const menuItems = [{ label: backLabel, icon: "☆" }];
    
    if (createAction) {
      menuItems.push({ label: createAction.label, icon: "☆" });
    }

    items.forEach(item => {
      const formatted = formatItem(item);
      menuItems.push({ label: formatted, icon: "☆" });
    });

    const header = typeof headerContent === "function" 
      ? await headerContent(metadata) 
      : headerContent;

    const selected = await selectMenu(title, menuItems, 0, "", header, breadcrumb);

    // Back or ESC
    if (selected === -1 || selected === 0) {
      return;
    }

    // Create action
    if (createAction && selected === 1) {
      await createAction.action();
      continue;
    }

    // Select item
    const offset = createAction ? 2 : 1;
    const itemIndex = selected - offset;
    
    if (itemIndex >= 0 && itemIndex < items.length) {
      await onSelect(items[itemIndex]);
    }
  }
}

module.exports = {
  showMenuWithBack,
  showListMenu
};
