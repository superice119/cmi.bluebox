var debug = require('debug')('testlib'),
    http = require('http'),
    path = require('path'),
    temp = require('temp'),
    URL = require('url'),
    webdriver = require('selenium-webdriver'),
    runtime = require('../lib/runtime');

function getWebdriverTimeout() {
    return 1000 *
        (process.env["BLUEBOXNOC_WEBDRIVER_TIMEOUT_SECONDS"] || 10);
}

/**
 * Start a Web server on a random port then call done().
 * @param app An instance of express
 */
module.exports.startServer = function (app, done) {
    server = http.createServer(app);
    server.on('error', function (error) {
        done(error);
    });
    server.on('listening', function() {
        var addr = server.address();
        app.set('port', addr.port);
        server.port = addr.port;
        server.baseUrl = 'http://localhost:' + addr.port + '/';
        done();
    });
    server.listen(0);
    return server;
};

var WebdriverTest = module.exports.WebdriverTest = {};

/**
 * Wrapper around Mocha and Selenium for UI tests.
 *
 * Automagically make this.driver and this.server available from
 * the test bodies (within "it" callbacks). this.driver is the
 * WebDriver object (see examples in
 * https://code.google.com/p/selenium/wiki/WebDriverJs).
 * this.server is an http.Server instance running the app.
 *
 * Additionally, navigating to relative URLs (e.g. "/") is supported
 *
 * @param description Like Mocha's first parameter to describe()
 * @param suiteBody Like Mocha's second parameter to describe()
 */
WebdriverTest.describe = function (description, suiteBody) {
    if (! suiteBody) {
        return wdtesting.describe(description);
    }
    var wdtesting = require('selenium-webdriver/testing');

    var mochaBefore = before;
    return wdtesting.describe(description, function () {
        var self = this;
        this.timeout(getWebdriverTimeout());
        this.setUpFakeData = module.exports.WebdriverTest.setUpFakeData;

        // For some reason wdtesting.before won't wait for the callback:
        mochaBefore(function(done) {
            if (! self.app) {
                self.app = require("../app");
            }
            self.server = module.exports.startServer(self.app, done);
        });

        var chrome = require('selenium-webdriver/chrome');
        chrome.setDefaultService(new chrome.ServiceBuilder()
            .setStdio('inherit')
            .enableVerboseLogging()
            .loggingTo('/tmp/chromedriver.log')
            .build());
        self.driver = new webdriver.Builder().
            withCapabilities(webdriver.Capabilities.chrome()).build();
        wdtesting.before(function () {
            decorateDriver(self.driver, self.server.baseUrl);
        });
        if (runtime.isDocker()) {
            // Keep browser open; closing the container takes care of it
        } else if (process.env.DEBUG &&
            process.env.DEBUG.search("browser") >= 0) {
            // User requests browser be kept open
        } else {
            wdtesting.after(function() {
                self.driver.quit();
            });
        }

        // Not the most elegant (as compared to say, running suiteBody inside
        // vm.runInNewContext), but gets the job done:
        var itOrig = global.it;
        try {
            global.it = decorateIt(itOrig, self, wdtesting.it);
            return suiteBody.call(self);
        } finally {
            global.it = itOrig;
        }
    });
};

WebdriverTest.setUpFakeData = function(done) {
    runtime.srvDir(temp.mkdirSync("BlueBoxNocFakeData"));
    var perl = require('../lib/perl');
    perl.runPerl(
        [path.resolve(runtime.srcDir(), "devsupport/make-fake-data.pl")],
        "",
        function (perlOut, perlExitCode, perlErr) {
            if (perlExitCode) {
                done(new Error(perlErr));
            } else {
                done();
            }
        }
    );
};

/**
 * Get the XPath from the document root to this element.
 *
 * @returns {!webdriver.promise.Promise.<string>} A promise that will be
 *     resolved with the element's pseudo-XPath.
 */
WebdriverTest.getXPath = function(elem) {
    return elem.driver_.executeScript(
        // Adapted from https://stackoverflow.com/questions/4176560
        // This is mobile code, it gets stringified and sent into the
        // browser, yow!
        function getXPath(node) {
            if (node.id !== '') {
                return '//' + node.tagName.toLowerCase() + '[@id="' + node.id + '"]';
            }
            if (node === document.body) {
                return node.tagName.toLowerCase();
            }
            var nodeCount = 0;
            var childNodes = node.parentNode.childNodes;

            for (var i = 0; i < childNodes.length; i++) {
                var currentNode = childNodes[i];

                if (currentNode === node) {
                    return getXPath(node.parentNode) +
                        '/' + node.tagName.toLowerCase() +
                        '[' + (nodeCount + 1) + ']';
                }

                if (currentNode.nodeType === 1 &&
                    currentNode.tagName.toLowerCase() === node.tagName.toLowerCase()) {
                    nodeCount++;
                }
            }
        }, elem);
};

/**
 * Easier alternative to selenium-webdriver's findElement.
 *
 * Waits for the AngularJS app to be quiet (assuming there is at most
 * one on the page at the <body> element)
 *
 * @param driverOrElement A WebDriver driver or element object to
 *        anchor the search at
 * @param webdriverLocator A webdriver.By predicate
 * @returns  {!webdriver.promise.Promise.<string>} A promise that
 *     will be resolved with the element that was looked up. Ignoring the
 *     return value is fine, and simply asserts that the element exists.
 */
var findBy = WebdriverTest.findBy =
    function(driverOrElement, webdriverLocator) {
        var driver = driverOrElement.driver_ || driverOrElement;
        driver.manage().timeouts().setScriptTimeout(getWebdriverTimeout());
        driver.executeAsyncScript(function () {
            // Mobile code! Executes in the browser!
            var callback = arguments[arguments.length - 1];
            try {
                if (window.angular) {
                    angular.getTestability(document.body).whenStable(callback);
                } else {
                    callback("No angular!");
                }
            } catch (err) {
                callback(err.message);
            }
        }).then(function (opt_errorMsg) {
            if (opt_errorMsg) {
                return webdriver.promise.rejected(opt_errorMsg);
            } else {
                return webdriver.promise.fulfilled();
            }
        });
        return driverOrElement.findElement(webdriverLocator);
};

/**
 * Find regular text (not necessarily within an &lt;a&gt; tag).
 *
 * @param driverOrElement A WebDriver driver or element object to
 *        anchor the search at
 * @param text The text to find
 * @returns  {!webdriver.promise.Promise.<string>} A promise that will be
 *     resolved with the text node's parent element (given that at least
 *     WD + Chromedriver refuses to select text nodes directly)
 */
WebdriverTest.findText = function(driverOrElement, text) {
    return findBy(driverOrElement,
        webdriver.By.xpath('descendant::text()[contains(., "' + text + '")]' +
            // (Under Chrome at least) .findElement refuses to select a text
            // node, hence we've got to go up like so:
        '/..'));
};

/**
 * Find an &lt;a&gt; link by its text.
 *
 * @param driverOrElement A WebDriver driver or element object to
 *        anchor the search at
 * @param text The text to find
 * @returns  {!webdriver.promise.Promise.<string>} A promise that
 *     will be resolved with the an &lt;a&gt; link element
 */
WebdriverTest.findLinkByText = function(driverOrElement, text) {
        return findBy(driverOrElement, webdriver.By.linkText(text));
};


/**
 * Find an &lt;button&gt; by its text.
 *
 * @param driverOrElement A WebDriver driver or element object to
 *        anchor the search at
 * @param text The text to find
 * @returns  {!webdriver.promise.Promise.<string>} A promise that
 *     will be resolved with the an &lt;button&gt;  element
 */
WebdriverTest.findButton = function(driverOrElement, text) {
        return findBy(driverOrElement,
            webdriver.By.xpath('.//button[contains(text(), "' + text + '")]'));
    };

/**
 * Find an input field or button by its accompanying label.
 *
 * @param driverOrElement A WebDriver driver or element object to
 *        anchor the search at
 * @param text The text to find
 * @returns  {!webdriver.promise.Promise.<string>} A promise that
 *     will be resolved with the element pointed to by the "for"
 *     attribute of the &lt;label&gt; element containing {@param text}
 */
WebdriverTest.findByLabel = function (driverOrElement, text) {
        return findBy(driverOrElement,
            webdriver.By.xpath('.//label[contains(text(), "' + text + '")]'))
            .then(function (elem) {
                return elem.getAttribute('for')
            })
            .then(function (forAttributeValue) {
                return driverOrElement.findElement(
                    webdriver.By.id(forAttributeValue));
            });
    };

WebdriverTest.findAncestorNode = function(driverOrElement, parentTag) {
    return driverOrElement.findElement(webdriver.By.xpath(
        'ancestor::' + parentTag));
};

function decorateIt(itOrig, self, itFromWdtesting) {
    var it = function(description, testBody) {
        if (!testBody) {
            return itOrig(description);
        }
        return itFromWdtesting(description, function () {
            this.driver = self.driver;
            this.app = self.app;
            testBody.call(this);
        });
    };
    // The more you know: selenium-webdriver's it.only is implemented
    // in terms of it, and looks it up from the context (a.k.a. global
    // object) at run time. We don't want to wrap it twice.
    it.only = itOrig.only;
    return it;
}

function decorateDriver(driverObj, baseUrl) {
    var navigateOrig = driverObj.navigate;
    driverObj.navigate = (function () {
        var navigator = navigateOrig.call(driverObj);
        var toOrig = navigator.to;
        navigator.to = function (url) {
            if (! URL.parse(url).host) {
                url = URL.resolve(baseUrl, url);
            }
            return toOrig.call(navigator, url);
        };
        return navigator;
    }).bind(driverObj);
}
