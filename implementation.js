/* eslint-env es2023 */
/* globals Cc ChromeUtils Ci console Services */
/* eslint no-undef: ["error"] */

const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
const { FetchConfig } = ChromeUtils.importESModule(
  "resource:///modules/accountcreation/FetchConfig.sys.mjs"
);
const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
const { OAuth2Providers } = ChromeUtils.importESModule(
  "resource:///modules/OAuth2Providers.sys.mjs"
);

const resProto = Cc["@mozilla.org/network/protocol;1?name=resource"].getService(
  Ci.nsISubstitutingProtocolHandler
);

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

function updateUI(win) {
  const doc = win.document;
  let addonUI = doc.querySelector("account-check-ui");
  if (!addonUI) {
    const script = doc.createElement("script");
    script.type = "module";
    script.src = "resource://account-check/account-check-ui.mjs";
    doc.head.appendChild(script);

    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = "resource://account-check/account-check-ui.css";
    doc.head.appendChild(link);

    const containerBox = doc.getElementById("containerBox");
    const securityDiv = containerBox.querySelector(
      "#containerBox > div:has(#server\\.socketType)"
    );
    addonUI = containerBox.insertBefore(
      doc.createElement("account-check-ui"),
      securityDiv?.nextElementSibling
    );
  }
  if (addonUI.beginCheck) {
    addonUI.beginCheck();
  }
}

var account_check = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    context.callOnClose(this);
    resProto.setSubstitution("account-check", this.extension.rootURI);

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
    resProto.setSubstitution("account-check", null);
  }
};
