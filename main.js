/* eslint-disable max-len */
const Apify = require("apify");
// eslint-disable-next-line import/no-extraneous-dependencies

const { log } = Apify.utils;
const { create } = require("xmlbuilder2");
const cheerio = require("cheerio");
const _ = require("lodash");
// maxItems in rss feed
const maxItems = 20;

// base Xml factory
const creteBaseXmlFromFeed = async function (rssLink) {
    const response = await Apify.utils.requestAsBrowser({ url: rssLink });
    const xmlDoc = create(response.body);
    const xmlObj = xmlDoc.end({ format: "object", noDoubleEncoding: true });
    // add required attributes
    xmlObj.rss["@version"] = "2.0";
    xmlObj.rss["@xmlns:media"] = "http://search.yahoo.com/mrss/";
    xmlObj.rss["@xmlns:dc"] = "http://purl.org/dc/elements/1.1/";
    xmlObj.rss["@xmlns:content"] = "http://purl.org/rss/1.0/modules/content/";

    sortByPubDate(xmlObj);
    xmlObj.rss.channel.item = takeLastItems(xmlObj, maxItems);
    // set lastBuildDate and pubDate
    xmlObj.rss.channel.lastBuildDate = xmlObj.rss.channel.pubDate =
        new Date().toUTCString();

    // handle each item - add/remove info
    xmlObj.rss.channel.item.map((item, idx, level) => {
        delete item.enclosure;
        delete item["media:content"];

        if (item.category["$"] === "Uncategorized") {
            item.category = "";
        }

        // remove CDATA and tags from description
        const htmlDescription = item.description["$"];
        let $ = cheerio.load(htmlDescription);
        const textDescription = $("div").text().trim();
        item.description = textDescription;

        // remove SVG separator from the content
        let htmlContent = item["content:encoded"]["$"];
        $ = cheerio.load(htmlContent);
        const contentWithoutSVG = $("div.npagebreak").remove();
        item["content:encoded"]["$"] = $.html();

        return item;
    });

    // delete not-required tags from rss and channel tags
    delete xmlObj.rss["@xmlns:wfw"];
    delete xmlObj.rss["@xmlns:atom"];
    delete xmlObj.rss["@xmlns:sy"];
    delete xmlObj.rss["@xmlns:slash"];
    delete xmlObj.rss.channel["sy:updatePeriod"];
    delete xmlObj.rss.channel["sy:updateFrequency"];
    delete xmlObj.rss.channel["atom:link"];
    delete xmlObj.rss.channel.generator;

    return xmlObj;
};

// Apple News Xml factory
const createAppleNewsXml = (baseXml) => {
    const appleNewsXml = _.cloneDeep(baseXml);
    // add required for AppleNews attributes
    appleNewsXml.rss["@xmlns:flatplan"] = "https://www.flatplan.io/feedspec/";

    // handle each item - add/remove info specifc for ApleNews
    appleNewsXml.rss.channel.item.map((item, idx, level) => {
        item["flatplan:template"] = {
            "@identifier": "standard",
        };
        item["flatplan:parameters"] = {
            "@isPreview": "true",
        };

        return item;
    });

    return appleNewsXml;
};

// Smart News Xml factory
const createSmartNewsXml = (baseXml) => {
    const smartNewsXml = _.cloneDeep(baseXml);
    // add required for SmartNews attributes
    smartNewsXml.rss["@xmlns:snf"] = "http://www.smartnews.be/snf";

    // handle each item - add/remove info specifc for SmartNews
    smartNewsXml.rss.channel.item.map((item, idx, level) => {
        // for example we can add google analytics script (if it is present at the source page)
        const script = "<script></script>"; // here we can init crawler and get script from each item.url if needed
        item["snf:analytics"] = script;
        return item;
    });

    return smartNewsXml;
};

// Truncated Xml factory
const createTruncatedXml = (appleNewsXml) => {
    const truncatedXml = _.cloneDeep(appleNewsXml);

    // handle each item - add/remove info specifc for SmartNews
    truncatedXml.rss.channel.item.map((item, idx, level) => {
        // delete content block
        delete item["content:encoded"];
    });

    return truncatedXml;
};

// helper functions:
const sortByPubDate = (xmlObj) => {
    if (Array.isArray(xmlObj.rss.channel.item)) {
        xmlObj.rss.channel.item.sort(
            (x, y) =>
                new Date(y.pubDate).valueOf() - new Date(x.pubDate).valueOf()
        );
    }
};

const takeLastItems = (xmlObj, maxItems = 0) => {
    if (Array.isArray(xmlObj.rss.channel.item)) {
        xmlObj.rss.channel.item = xmlObj.rss.channel.item.slice(0, maxItems);
    }
    return xmlObj.rss.channel.item;
};

const save = async (key, xmlObj, storage) => {
    const docNew = create(xmlObj);
    const xml = docNew.end({ prettyPrint: true, noDoubleEncoding: true });
    await storage.setValue(key, xml, { contentType: "application/xml" });

    const url =
        "https://api.apify.com/v2/key-value-stores/HUqNhm0yfY7sj5L4Y/records/" +
        key;
    return url;
};

// main Apify function
Apify.main(async () => {
    const { url } = await Apify.getInput();

    const baseXmlObj = await creteBaseXmlFromFeed(url);

    const appleNewsXml = createAppleNewsXml(baseXmlObj);
    const smartNewsXml = createSmartNewsXml(baseXmlObj);
    const truncatedXml = createTruncatedXml(appleNewsXml);

    const KVS = await Apify.openKeyValueStore("narratively");

    // save
    await save("apple-news", appleNewsXml, KVS);
    await save("smartnews", smartNewsXml, KVS);
    await save("truncated", truncatedXml, KVS);
});
