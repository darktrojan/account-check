/* eslint-env es2023 */
/* globals Cc ChromeUtils Ci Services */
/* eslint no-undef: ["error"] */

const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

let baseURL, basePath;

function observe(doc) {
  if (doc.documentURI == "chrome://messenger/content/am-server.xhtml") {
    const win = doc.ownerGlobal;
    const onPreInit = win.onPreInit;
    win.onPreInit = function (account, accountValues) {
      onPreInit(account, accountValues);
      updateUI(win);
    };
    return;
  }
  if (doc.documentURI == "chrome://messenger/content/am-smtp.xhtml") {
    const win = doc.ownerGlobal;
    const onSelectionChanged =
      win.gSmtpServerListWindow.onSelectionChanged.bind(
        win.gSmtpServerListWindow
      );
    win.gSmtpServerListWindow.onSelectionChanged = function () {
      onSelectionChanged();
      updateUI(win);
    };
  }
}

async function updateUI(win) {
  const doc = win.document;
  let addonUI = doc.querySelector("account-check-ui");
  if (!addonUI) {
    const containerBox = doc.getElementById("containerBox");
    const securityDiv = containerBox.querySelector(
      "#containerBox > div:has(#server\\.socketType)"
    );
    addonUI = containerBox.insertBefore(
      doc.createElement("account-check-ui"),
      securityDiv?.nextElementSibling
    );

    const script = doc.createElement("script");
    script.textContent = await IOUtils.readUTF8(
      PathUtils.join(basePath, "account-check-ui.mjs")
    );
    doc.head.appendChild(script);

    const style = doc.createElement("style");
    style.textContent = await IOUtils.readUTF8(
      PathUtils.join(basePath, "account-check-ui.css")
    );
    doc.head.appendChild(style);
  }
  if (addonUI.beginCheck) {
    addonUI.beginCheck();
  }
}

var account_check = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    context.callOnClose(this);
    baseURL = this.extension.baseURL;
    basePath = this.extension.rootURI.filePath;

    return {
      account_check: {
        async init() {
          Services.obs.addObserver(observe, "chrome-document-loaded");
        },
      },
    };
  }
  close() {
    Services.obs.removeObserver(observe, "chrome-document-loaded");
  }
};
