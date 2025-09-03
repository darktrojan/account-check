/* eslint-env es2023, browser */
/* globals ChromeUtils Ci Services */
/* eslint no-undef: ["error"] */

{

const { FetchConfig } = ChromeUtils.importESModule(
  "resource:///modules/accountcreation/FetchConfig.sys.mjs"
);
const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
const { OAuth2Providers } = ChromeUtils.importESModule(
  "resource:///modules/OAuth2Providers.sys.mjs"
);

class AccountCheckUI extends HTMLElement {
  #checking = false;
  #status;
  #list;
  #button;
  #server;
  #foundConfig;
  #foundLogins;

  connectedCallback() {
    const left = this.appendChild(document.createElement("div"));
    this.#status = left.appendChild(document.createElement("div"));
    this.#status.appendChild(document.createElement("img"));
    this.#status.appendChild(document.createTextNode(""));
    this.#list = left.appendChild(document.createElement("ul"));
    const right = this.appendChild(document.createElement("div"));
    this.#button = right.appendChild(document.createElement("button"));
    this.#button.textContent = "Apply and Restart";
    this.#button.onclick = () => this.onButtonClick();

    this.beginCheck();
  }

  getServer() {
    if (window.gServer) {
      return window.gServer;
    }
    if (window.gSmtpServerListWindow) {
      return window.gSmtpServerListWindow
        .getSelectedServer()
        .QueryInterface(Ci.nsISmtpServer);
    }
    return null;
  }

  getAccount() {
    if (this.#server.type == "smtp") {
      return MailServices.accounts.accounts.find(
        a => a.defaultIdentity?.smtpServerKey == this.#server.key
      );
    }
    return MailServices.accounts.findAccountForServer(this.#server);
  }

  async beginCheck() {
    if (this.#checking) {
      return;
    }
    this.#checking = true;

    const server = this.getServer();
    if (!["imap", "pop3", "smtp"].includes(server.type)) {
      this.hidden = true;
      this.#server = null;
      return;
    }
    this.#server = server;
    const direction = server.type == "smtp" ? "outgoing" : "incoming";
    const account = this.getAccount();
    if (!account?.defaultIdentity?.email) {
      return;
    }

    this.#foundConfig = null;
    this.#foundLogins = null;
    this.#status.lastChild.nodeValue = `Checking ${server.key}…`;
    this.#status.hidden = false;
    this.#list.hidden = true;
    this.#list.replaceChildren();
    this.#button.hidden = true;

    this.hidden = false;
    const config = await this.fetchConfig(account.defaultIdentity.email);

    if (server != this.getServer()) {
      // This isn't the current server any more.
      return;
    }

    if (config && config[direction].type == server.type) {
      this.endCheck(config[direction]);
      return;
    } else if (config) {
      for (const alternative of config[`${direction}Alternatives`]) {
        if (alternative.type == this.#server.type) {
          this.endCheck(alternative);
          return;
        }
      }
    }

    this.findLogins();
  }

  async fetchConfig(emailAddress) {
    const domain = emailAddress.replace(/.*@/, "");

    let deferred = Promise.withResolvers();
    this.#status.lastChild.nodeValue =
      "Looking up configuration: Thunderbird installation…";
    FetchConfig.fromDisk(domain, deferred.resolve, deferred.reject);

    try {
      const config = await deferred.promise;
      return config;
    } catch (ex) {
      console.warn(ex.message);
    }

    if (this.#server != this.getServer()) {
      return null;
    }

    deferred = Promise.withResolvers();
    this.#status.lastChild.nodeValue =
      "Looking up configuration: Email provider…";
    FetchConfig.fromISP(
      domain,
      emailAddress,
      deferred.resolve,
      deferred.reject
    );

    try {
      const config = await deferred.promise;
      return config;
    } catch (ex) {
      console.warn(ex.message);
    }

    if (this.#server != this.getServer()) {
      return null;
    }

    deferred = Promise.withResolvers();
    this.#status.lastChild.nodeValue =
      "Looking up configuration: Mozilla ISP database…";
    FetchConfig.fromDB(domain, deferred.resolve, deferred.reject);

    try {
      const config = await deferred.promise;
      return config;
    } catch (ex) {
      console.warn(ex.message);
    }

    if (this.#server != this.getServer()) {
      return null;
    }

    deferred = Promise.withResolvers();
    this.#status.lastChild.nodeValue = "Looking up configuration: Mail domain…";
    FetchConfig.forMX(domain, emailAddress, deferred.resolve, deferred.reject);

    try {
      const config = await deferred.promise;
      return config;
    } catch (ex) {
      console.warn(ex.message);
    }

    return null;
  }

  endCheck(config) {
    this.#foundConfig = config;

    const account = this.getAccount();
    const emailAddress = account.defaultIdentity.email;
    const configUsername = config.username
      .replace("%EMAILADDRESS%", emailAddress)
      .replace("%EMAILLOCALPART%", emailAddress.replace(/@[^@]*$/, ""))
      .replace("%EMAILDOMAIN%", emailAddress.replace(/.*@/, ""));

    const hostname = this.#server.hostname ?? this.#server.hostName;
    if (hostname != config.hostname) {
      this.appendListItem(
        `Use recommended server name (${config.hostname})`,
        "hostname",
        config.hostname
      );
    }
    if (this.#server.port != config.port) {
      this.appendListItem(
        `Use recommended port (${config.port})`,
        "port",
        config.port
      );
    }
    if (this.#server.username != configUsername) {
      this.appendListItem(
        `Use recommended user name (${configUsername})`,
        "username",
        configUsername
      );
    }
    if (this.#server.socketType != config.socketType) {
      const text = {
        [Ci.nsMsgSocketType.plain]: "None",
        [Ci.nsMsgSocketType.alwaysSTARTTLS]: "STARTTLS",
        [Ci.nsMsgSocketType.SSL]: "SSL/TLS",
      }[config.socketType];
      this.appendListItem(
        `Use recommended security (${text})`,
        "socketType",
        config.socketType
      );
    }
    if (this.#server.authMethod != config.auth) {
      let text;
      if (config.auth == Ci.nsMsgAuthMethod.passwordCleartext) {
        if (
          config.socketType == Ci.nsMsgSocketType.SSL ||
          config.socketType == Ci.nsMsgSocketType.alwaysSTARTTLS
        ) {
          text = "Normal password";
        } else {
          text = "Password, transmitted insecurely";
        }
      } else {
        text = {
          [Ci.nsMsgAuthMethod.none]: "No authentication",
          [Ci.nsMsgAuthMethod.old]: "Password, original method (insecure)",
          [Ci.nsMsgAuthMethod.passwordEncrypted]: "Encrypted password",
          [Ci.nsMsgAuthMethod.GSSAPI]: "Kerberos / GSSAPI",
          [Ci.nsMsgAuthMethod.NTLM]: "NTLM",
          [Ci.nsMsgAuthMethod.External]: "TLS Certificate",
          [Ci.nsMsgAuthMethod.secure]: "Any secure method (deprecated)",
          [Ci.nsMsgAuthMethod.anything]: "Any method (insecure)",
          [Ci.nsMsgAuthMethod.OAuth2]: "OAuth2",
        }[config.auth];
      }
      this.appendListItem(
        `Use recommended authentication method (${text})`,
        "authMethod",
        config.auth
      );
    }

    this.findLogins();
  }

  findLogins() {
    let { type, hostname, hostName, username } = this.#server;
    hostname ??= hostName;
    if (type == "pop3") {
      type = "mailbox";
    }
    this.#foundLogins = Services.logins
      .findLogins(`${type}://${hostname}`, null, "")
      .filter(login => login.username == username);

    let oAuthHostName =
      this.#server.type == "smtp"
        ? Services.prefs.getStringPref(
            `mail.smtpserver.${this.#server.key}.oauth2.issuer`,
            ""
          )
        : this.#server.getStringValue("oauth2.issuer");
    if (!oAuthHostName) {
      const oAuthDetails = OAuth2Providers.getHostnameDetails(
        hostname,
        this.#server.type
      );
      oAuthHostName = oAuthDetails?.[0];
    }
    if (oAuthHostName) {
      this.#foundLogins = this.#foundLogins.concat(
        Services.logins
          .findLogins(`oauth://${oAuthHostName}`, null, "")
          .filter(login => login.username == username)
      );
    }

    if (this.#foundLogins.length) {
      this.appendListItem(
        `Clear ${this.#foundLogins.length} password${
          this.#foundLogins.length == 1 ? "" : "s"
        }`,
        "logins",
        ""
      );
    } else {
      this.updateStatusAndButton();
    }
  }

  appendListItem(text, name, value) {
    const item = this.#list.appendChild(document.createElement("li"));
    const label = item.appendChild(document.createElement("label"));
    const checkbox = label.appendChild(document.createElement("input"));
    checkbox.type = "checkbox";
    checkbox.name = name;
    checkbox.value = value;
    checkbox.onchange = () => this.enableButton();
    label.appendChild(document.createTextNode(text));

    this.updateStatusAndButton();
  }

  updateStatusAndButton() {
    if (this.#list.childElementCount == 0) {
      if (this.#foundConfig) {
        this.#status.lastChild.nodeValue = "All settings appear correct.";
      } else {
        this.#status.lastChild.nodeValue =
          "Thunderbird failed to find the settings for your email account";
      }
      this.#button.hidden = true;
      this.#list.hidden = true;
    } else {
      this.#status.lastChild.nodeValue = "Suggested actions:";
      this.enableButton();
      this.#button.hidden = false;
      this.#list.hidden = false;
    }
  }

  enableButton() {
    for (const checkbox of this.#list.querySelectorAll(
      `input[type="checkbox"]`
    )) {
      if (checkbox.checked) {
        this.#button.disabled = false;
        return;
      }
    }
    this.#button.disabled = true;
  }

  onButtonClick() {
    for (const checkbox of this.#list.querySelectorAll(
      `input[type="checkbox"]`
    )) {
      if (!checkbox.checked) {
        continue;
      }

      switch (checkbox.name) {
        case "hostname":
          if (this.#server.type != "smtp") {
            this.#server.hostName = checkbox.value;
            break;
          }
        // Falls through.
        case "port":
        case "username":
        case "socketType":
        case "authMethod":
          this.#server[checkbox.name] = checkbox.value;
          break;
        case "logins":
          Services.prefs.clearUserPref(
            `mail.server.${this.#server.key}.oauth2.issuer`
          );
          Services.prefs.clearUserPref(
            `mail.server.${this.#server.key}.oauth2.scope`
          );
          for (const login of this.#foundLogins) {
            Services.logins.removeLogin(login);
          }
          break;
      }
    }

    Services.startup.quit(
      Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
    );
  }
}
window.customElements.define("account-check-ui", AccountCheckUI);

}
