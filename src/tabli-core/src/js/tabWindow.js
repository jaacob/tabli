/**
 * Representation of tabbed windows using Immutable.js
 */
import * as _ from 'lodash';
import * as Immutable from 'immutable';

/**
 * Tab state that is persisted as a bookmark
 */
const SavedTabState = Immutable.Record({
  bookmarkId: '',
  bookmarkIndex: 0,   // position in bookmark folder
  title: '',
  url: ''  
});


/**
 * Tab state associated with an open browser tab
 */
const OpenTabState = Immutable.Record({
  url: '',
  openTabId: -1,
  active: false,
  openTabIndex: 0,  // index of open tab in its window
  favIconUrl: '',
  title: '',
  audible: false  
});


/**
 * An item in a tabbed window.
 *
 * May be associated with an open tab, a bookmark, or both
 */
export class TabItem extends Immutable.Record({
  url: '',

  saved: false,
  savedState: null, // SavedTabState iff saved

  open: false,    // Note: Saved tabs may be closed even when containing window is open
  openState: null // OpenTabState iff open
}) {
  get title() {
    if (this.open) {
      return this.openState.title;
    }

    return this.savedState.title;
  }
}

/**
 * Initialize saved tab state from a bookmark
 */
function makeSavedTabState(bm) {
  const url = _.get(bm,'url','');
  if (url.length===0) {
    console.warn('makeSavedTabState: malformed bookmark: missing URL!: ', bm);    
  }
  const ts = new SavedTabState({
    url,
    title: _.get(bm,'title',url),
    bookmarkId: bm.id,
    bookmarkIndex: bm.index
  });
  return ts;
}

/**
 * Initialize a TabItem from a bookmark
 *
 * Returned TabItem is closed (not associated with an open tab)
 */
function makeBookmarkedTabItem(bm) {
  const savedState = makeSavedTabState(bm);

  const tabItem = new TabItem({
    url: savedState.url,
    saved: true,
    savedState
  });
  return tabItem;
}

/**
 * initialize OpenTabState from a browser tab
 */
function makeOpenTabState(tab) {
  const url = _.get(tab,'url','');
  if (url.length===0) {
    console.warn('makeOpenTabState: no URL for tab: ', tab);    
  }
  const ts = new OpenTabState({
    url,
    audible: tab.audible,
    favIconUrl: tab.favIconUrl,
    title: _.get(tab, 'title', url),
    openTabId: tab.id,
    active: tab.active,
    openTabIndex: tab.index
  });
  return ts;
}

/**
 * Initialize a TabItem from an open Chrome tab
 */
function makeOpenTabItem(tab) {
  const openState = makeOpenTabState(tab);

  const tabItem = new TabItem({
    url: openState.url,
    open: true,
    openState
  });
  return tabItem;
}

/**
 * Returns the base saved state of a tab item (no open tab info)
 */
function resetSavedItem(ti) {
  return ti.remove('open').remove('openState');
}

/**
 * Return the base state of an open tab (no saved tab info)
 */
function resetOpenItem(ti) {
  return ti.remove('saved').remove('savedState');
}

/**
 * A TabWindow
 *
 * Tab windows have a title and a set of tab items.
 *
 * A TabWindow has 3 possible states:
 *   (open,!saved)   - An open Chrome window that has not had its tabs saved
 *   (open,saved)    - An open Chrome window that has also had its tabs saved (as bookmarks)
 *   (!open,saved)   - A previously saved window that is not currently open
 */
export class TabWindow extends Immutable.Record({
  saved: false,
  savedTitle: '',
  savedFolderId: -1,

  open: false,
  openWindowId: -1,
  windowType: '',

  tabItems: Immutable.Seq(),  // <TabItem>
}) {

  get title() {
    if (this._title === undefined) {
      this._title = this.computeTitle();
    }

    return this._title;
  }

  computeTitle() {
    if (this.saved) {
      return this.savedTitle;
    }

    const activeTab = this.tabItems.find((t) => t.open && t.openState.active);

    if (!activeTab) {
      // shouldn't happen!
      console.warn('TabWindow.get title(): No active tab found: ', this.toJS());

      var openTabItem = this.tabItems.find((t) => t.open);
      if (!openTabItem) {
        return '';
      }
      return openTabItem.title;
    }

    return activeTab.title;
  }

  get openTabCount() {
    return this.tabItems.count((ti) => ti.open);
  }
}

/**
 * reset a window to its base saved state (after window is closed)
 */
export function removeOpenWindowState(tabWindow) {
  const savedItems = tabWindow.tabItems.filter((ti) => ti.saved);
  const resetSavedItems = savedItems.map(resetSavedItem);

  return tabWindow.remove('open').remove('openWindowId').remove('windowType').set('tabItems', resetSavedItems);
}

/*
 * remove any saved state, keeping only open tab and window state
 *
 * Used when unsave'ing a saved window
 */
export function removeSavedWindowState(tabWindow) {
  return tabWindow.remove('saved').remove('savedFolderId').remove('savedTitle');
}

/**
 * Initialize an unopened TabWindow from a bookmarks folder
 */
export function makeFolderTabWindow(bookmarkFolder) {
  const itemChildren = bookmarkFolder.children.filter((node) => 'url' in node);
  const tabItems = Immutable.Seq(itemChildren.map(makeBookmarkedTabItem));
  var fallbackTitle = '';
  if (bookmarkFolder.title === undefined) {
    console.error('makeFolderTabWindow: malformed bookmarkFolder -- missing title: ', bookmarkFolder);
    if (tabItems.count() > 0) {
      fallbackTitle = tabItems.get(0).title;
    }
  }

  const tabWindow = new TabWindow({
    saved: true,
    savedTitle: _.get(bookmarkFolder, 'title', fallbackTitle),
    savedFolderId: bookmarkFolder.id,
    tabItems,
  });

  return tabWindow;
}

/**
 * Initialize a TabWindow from an open Chrome window
 */
export function makeChromeTabWindow(chromeWindow) {
  const chromeTabs = chromeWindow.tabs ? chromeWindow.tabs : [];
  const tabItems = chromeTabs.map(makeOpenTabItem);
  const tabWindow = new TabWindow({
    open: true,
    openWindowId: chromeWindow.id,
    windowType: chromeWindow.type,
    tabItems: Immutable.Seq(tabItems),
  });

  return tabWindow;
}

/**
 * Gather open tab items and a set of non-open saved tabItems from the given
 * open tabs and tab items based on URL matching, without regard to
 * tab ordering.  Auxiliary helper function for mergeOpenTabs.
 */
function getOpenTabInfo(tabItems, openTabs) {
  const chromeOpenTabItems = Immutable.Seq(openTabs.map(makeOpenTabItem));

  // console.log("getOpenTabInfo: openTabs: ", openTabs);
  // console.log("getOpenTabInfo: chromeOpenTabItems: " + JSON.stringify(chromeOpenTabItems,null,4));
  const openUrlMap = Immutable.Map(chromeOpenTabItems.groupBy((ti) => ti.url));

  // console.log("getOpenTabInfo: openUrlMap: ", openUrlMap.toJS());

  // Now we need to do two things:
  // 1. augment chromeOpenTabItems with bookmark Ids / saved state (if it exists)
  // 2. figure out which savedTabItems are not in openTabs
  const savedItems = tabItems.filter((ti) => ti.saved);

  // Restore the saved items to their base state (no open tab info), since we
  // only want to pick up open tab info from what was passed in in openTabs
  const baseSavedItems = savedItems.map(resetSavedItem);

  // The entries in savedUrlMap *should* be singletons, but we'll use groupBy to
  // get a type-compatible Seq so that we can merge with openUrlMap using
  // mergeWith:
  const savedUrlMap = Immutable.Map(baseSavedItems.groupBy((ti) => ti.url));

  // console.log("getOpenTabInfo: savedUrlMap : " + savedUrlMap.toJS());

  function mergeTabItems(openItems, mergeSavedItems) {
    const savedItem = mergeSavedItems.get(0);
    return openItems.map((openItem) => openItem.set('saved', true)
                                        .set('savedState', savedItem.savedState));
  }

  const mergedMap = openUrlMap.mergeWith(mergeTabItems, savedUrlMap);

  // console.log("mergedMap: ", mergedMap.toJS());

  // console.log("getOpenTabInfo: mergedMap :" + JSON.stringify(mergedMap,null,4));

  // partition mergedMap into open and closed tabItems:
  const partitionedMap = mergedMap.toIndexedSeq().flatten(true).groupBy((ti) => ti.open);

  // console.log("partitionedMap: ", partitionedMap.toJS());

  return partitionedMap;
}

/**
 * Merge currently open tabs from an open Chrome window with tabItem state of a saved
 * tabWindow
 *
 * @param {Seq<TabItem>} tabItems -- previous TabItem state
 * @param {[Tab]} openTabs -- currently open tabs from Chrome window
 *
 * @returns {Seq<TabItem>} TabItems reflecting current window state
 */
function mergeOpenTabs(tabItems, openTabs) {
  const tabInfo = getOpenTabInfo(tabItems, openTabs);

  /* TODO: Use algorithm from OLDtabWindow.js to determine tab order.
   * For now, let's just concat open and closed tabs, in their sorted order.
   */
  const openTabItems = tabInfo.get(true, Immutable.Seq()).sortBy((ti) => ti.openState.openTabIndex);
  const closedTabItems = tabInfo.get(false, Immutable.Seq()).sortBy((ti) => ti.savedState.bookmarkIndex);

  const mergedTabItems = openTabItems.concat(closedTabItems);

  return mergedTabItems;
}

/**
 * update a TabWindow from a current snapshot of the Chrome Window
 *
 * @param {TabWindow} tabWindow - TabWindow to be updated
 * @param {ChromeWindow} chromeWindow - current snapshot of Chrome window state
 *
 * @return {TabWindow} Updated TabWindow
 */
export function updateWindow(tabWindow, chromeWindow) {
  // console.log("updateWindow: ", tabWindow.toJS(), chromeWindow);
  const mergedTabItems = mergeOpenTabs(tabWindow.tabItems, chromeWindow.tabs);
  const updWindow = tabWindow
                      .set('tabItems', mergedTabItems)
                      .set('windowType', chromeWindow.type)
                      .set('open', true)
                      .set('openWindowId', chromeWindow.id);
  return updWindow;
}

/**
 * handle a tab that's been closed
 *
 * @param {TabWindow} tabWindow - tab window with tab that's been closed
 * @param {Number} tabId -- Chrome id of closed tab
 *
 * @return {TabWindow} tabWindow with tabItems updated to reflect tab closure
 */
export function closeTab(tabWindow, tabId) {
  // console.log("closeTab: ", tabWindow, tabId);
  const entry = tabWindow.tabItems.findEntry((ti) => ti.open && ti.openState.openTabId === tabId);

  if (!entry) {
    console.warn("closeTab: could not find closed tab id ", tabId);
    return tabWindow;
  }
  const [index, tabItem] = entry;

  var updItems;

  if (tabItem.saved) {
    var updTabItem = resetSavedItem(tabItem);
    updItems = tabWindow.tabItems.splice(index, 1, updTabItem);
  } else {
    updItems = tabWindow.tabItems.splice(index, 1);
  }

  return tabWindow.set('tabItems', updItems);
}

/**
 * Update a tab's saved state
 *
 * @param {TabWindow} tabWindow - tab window with tab that's been closed
 * @param {TabItem} tabItem -- open tab that has been saved
 * @param {BookmarkTreeNode} tabNode -- bookmark node for saved bookmark
 *
 * @return {TabWindow} tabWindow with tabItems updated to reflect saved state
 */
export function saveTab(tabWindow, tabItem, tabNode) {
  var [index] = tabWindow.tabItems.findEntry((ti) => ti.open && ti.openState.openTabId === tabItem.openState.openTabId);

  const savedState = new SavedTabState(tabNode);

  const updTabItem = tabItem.set('saved', true)
                      .set('savedState', savedState);

  const updItems = tabWindow.tabItems.splice(index, 1, updTabItem);

  return tabWindow.set('tabItems', updItems);
}

/**
 * Update a tab's saved state when tab has been 'unsaved' (i.e. bookmark removed)
 *
 * @param {TabWindow} tabWindow - tab window with tab that's been unsaved
 * @param {TabItem} tabItem -- open tab that has been saved
 *
 * @return {TabWindow} tabWindow with tabItems updated to reflect saved state
 */
export function unsaveTab(tabWindow, tabItem) {
  var [index] = tabWindow.tabItems.findEntry((ti) => ti.saved && ti.savedState.bookmarkId === tabItem.savedState.bookmarkId);
  const updTabItem = resetOpenItem(tabItem);

  var updItems;
  if (updTabItem.open) {
    updItems = tabWindow.tabItems.splice(index, 1, updTabItem);
  } else {
    // It's neither open nor saved, so just get rid of it...
    updItems = tabWindow.tabItems.splice(index, 1);
  }

  return tabWindow.set('tabItems', updItems);
}

/**
 * Set the active tab in a window to the tab with specified tabId
 *
 * @param {TabWindow} tabWindow -- tab window to be updated
 * @param {tabId} activeTabId - chrome tab id of active tab
 *
 * @return {TabWindow} tabWindow updated with specified tab as active tab.
 */ 
export function setActiveTab(tabWindow, tabId) {
  const tabPos = tabWindow.tabItems.findEntry((ti) => ti.open && ti.openState.openTabId === tabId);

  if (!tabPos) {
    console.warn("setActiveTab -- tab id not found: ", tabId);
    return tabWindow;
  }

  const [index, tabItem] = tabPos;
  if (tabItem.active) {
    console.log("setActiveTab: tab was already active, igoring");
    return tabWindow;
  }

  const prevPos = tabWindow.tabItems.findEntry((ti) => ti.open && ti.openState.active )

  var nonActiveItems;
  if (prevPos) {
    const [prevIndex, prevActiveTab] = prevPos;
    const updPrevOpenState = prevActiveTab.openState.remove('active');
    const updPrevActiveTab = prevActiveTab.set('openState', updPrevOpenState);
    nonActiveItems = tabWindow.tabItems.splice(prevIndex, 1, updPrevActiveTab);
  } else {
    nonActiveItems = tabWindow.tabItems;
  }

  const updOpenState = tabItem.openState.set('active',true);
  const updActiveTab = tabItem.set('openState',updOpenState);
  const updItems = nonActiveItems.splice(index, 1, updActiveTab);

  return tabWindow.set('tabItems',updItems);
}

/**
 * update a tabItem in a TabWindow to latest chrome tab state
 *
 * May be called with a new or an existing tab
 *
 * @param {TabWindow} tabWindow -- tab window to be updated
 * @param {Tab} tab - chrome tab state 
 *
 * @return {TabWindow} tabWindow with updated tab state
 */
export function updateTabItem(tabWindow,tab) {
  /* TODO: Not quite right -- if tab.url differs from previous tabs[tabPos].url, may need to
   * split or merge tabItems
   */
  const tabItem = makeOpenTabItem(tab);
  const tabPos = tabWindow.tabItems.findEntry((ti) => ti.open && ti.openState.openTabId === tab.id);

  var updItems;
  if (!tabPos) {
    // new tab:
    updItems = tabWindow.tabItems.splice(tab.index,0,tabItem);
  } else {
    const [index] = tabPos;
    console.log("updateTabItem: ", index, tabItem.toJS());
    updItems = tabWindow.tabItems.splice(index,1,tabItem);
  }

  return tabWindow.set('tabItems',updItems);  
}