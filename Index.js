
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

async function main() {
    const browser = await chromium.launch({
        headless: false
    });

    try {
        const page = await browser.newPage();

        // 1. Open Flipkart
        await page.goto('https://www.flipkart.com/', {
            waitUntil: 'domcontentloaded'
        });

        await page.waitForTimeout(2000);

        // 2. Close login popup if present
        const closeButton = page.locator('span.b3wTIE').first();

        if (await closeButton.isVisible().catch(() => false)) {
            await closeButton.click();
            console.log('Login popup closed.');
        }

        // 3. Search for 5G mobiles
        const searchBox = page
            .locator('input[name="q"]:not([readonly])')
            .first();

        await searchBox.waitFor({
            state: 'visible',
            timeout: 15000
        });

        await searchBox.fill('mobile 5g');
        await searchBox.press('Enter');

        await page.waitForLoadState('domcontentloaded')
            .catch(() => {});

        await page.waitForTimeout(3000);

        console.log('Search results loaded.');

        // 4. Apply minimum price filter
        const minPrice = page.locator('select.hbnjE2').first();

        if (await minPrice.count() > 0) {
            await minPrice.selectOption('10000');
            console.log('Minimum price set to ₹10,000.');
        } else {
            console.log('Minimum price dropdown not found.');
        }

        await page.waitForTimeout(1500);

        // 5. Apply maximum price filter
        const maxPrice = page.locator('select.hbnjE2').nth(1);

        if (await maxPrice.count() > 0) {
            await maxPrice.selectOption('30000');
            console.log('Maximum price set to ₹30,000.');
        } else {
            console.log('Maximum price dropdown not found.');
        }

        await page.waitForTimeout(3000);

        console.log('Price filtering completed.');

        // 6. Collect product links and listing details
        const products = await page
            .locator('a[href*="/p/"]')
            .evaluateAll(anchors => {
                const unique = new Map();

                for (const anchor of anchors) {
                    const url = anchor.href.split('?')[0];

                    if (!url.includes('/p/')) continue;

                    const card =
                        anchor.closest('[data-id]') ||
                        anchor.parentElement;

                    const listingText = (
                        card?.innerText ||
                        anchor.innerText ||
                        ''
                    ).replace(/\s+/g, ' ').trim();

                    if (!unique.has(url)) {
                        unique.set(url, {
                            url,
                            listingText
                        });
                    }
                }

                return [...unique.values()];
            });

        console.log(`Found ${products.length} product links.`);

        if (products.length === 0) {
            console.log(
                'No products found. Check whether Flipkart loaded the results correctly.'
            );
        }

        // 7. Prepare product details collection
        const results = [];
        const detailPage = await browser.newPage();

        // Test with 20 products first.
        // Change to products.length to process all links on this page.
        const limit = Math.min(products.length, 20);

        for (let i = 0; i < limit; i++) {
            const product = products[i];

            try {
                console.log(
                    `Scraping product ${i + 1}/${limit}`
                );

                await detailPage.goto(product.url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });

                await detailPage.waitForTimeout(1200);

                // 8. Extract mobile information
                const mobile = await detailPage.evaluate(
                    ({ listingText, url }) => {
                        const clean = value =>
                            (value || '')
                                .replace(/\s+/g, ' ')
                                .trim();

                        const bodyText = clean(
                            document.body.innerText
                        );

                        const title =
                            clean(
                                document.querySelector('h1')
                                    ?.innerText
                            ) ||
                            clean(document.title);

                        // Read the displayed selling price
                        let price = '';

                        const priceSelectors = [
                            '[class*="Nx9bqj"]',
                            '[class*="hl05eU"]',
                            '[itemprop="price"]'
                        ];

                        for (const selector of priceSelectors) {
                            const element =
                                document.querySelector(selector);

                            const value = element
                                ? clean(
                                    element.innerText ||
                                    element.getAttribute('content')
                                )
                                : '';

                            if (value && /₹/.test(value)) {
                                price = value;
                                break;
                            }
                        }

                        // Fallback to product listing text
                        if (!price) {
                            const match = listingText.match(
                                /₹\s?[\d,]+/
                            );

                            if (match) price = match[0];
                        }

                        // Extract key-value specification tables
                        const specifications = {};

                        document.querySelectorAll('tr').forEach(row => {
                            const cells = [
                                ...row.querySelectorAll('th, td')
                            ]
                                .map(cell => clean(cell.innerText))
                                .filter(Boolean);

                            if (cells.length >= 2) {
                                specifications[cells[0]] =
                                    cells.slice(1).join(' | ');
                            }
                        });

                        // Collect Flipkart feature bullet points
                        const features = [];

                        document.querySelectorAll('li.DTBslk')
                            .forEach(element => {
                                const value = clean(element.innerText);

                                if (value) features.push(value);
                            });

                        // Also include specification section text
                        document.querySelectorAll(
                            '[class*="specification"], [class*="Specs"], [class*="row"]'
                        ).forEach(element => {
                            const text = clean(element.innerText);

                            if (
                                text &&
                                text.length < 300 &&
                                text.includes(':')
                            ) {
                                const index = text.indexOf(':');

                                const key = clean(
                                    text.slice(0, index)
                                );

                                const value = clean(
                                    text.slice(index + 1)
                                );

                                if (
                                    key &&
                                    value &&
                                    key.length < 100
                                ) {
                                    specifications[key] ||= value;
                                }
                            }
                        });

                        // Search for commonly available details
                        const findValue = regex => {
                            const match = bodyText.match(regex);
                            return match ? match[0] : '';
                        };

                        const originalPriceMatch = bodyText.match(
                            /₹\s?[\d,]+\s*(?=₹\s?[\d,]+)/
                        );

                        const discount = findValue(
                            /\b\d{1,2}%\s*off\b/i
                        );

                        const rating = findValue(
                            /\b[0-5]\.\d\s*(?:★)?/
                        );

                        const battery = findValue(
                            /\b\d{3,6}\s*mAh\b/i
                        );

                        const ramStorage = findValue(
                            /\b\d+\s*GB\s*RAM(?:\s*[,/]\s*\d+\s*GB(?:\s*(?:ROM|storage))?)?/i
                        );

                        const display = findValue(
                            /\b\d{1,2}(?:\.\d+)?\s*(?:cm|inches|inch)\b/i
                        );

                        const camera = findValue(
                            /\b\d+\s*MP\b/i
                        );

                        const processor = findValue(
                            /\b(?:Snapdragon|MediaTek|Dimensity|Helio|Exynos|Tensor|Unisoc)[^,\n]*/i
                        );

                        const operatingSystem = findValue(
                            /\b(?:Android|iOS)\s*[\d.]*/i
                        );

                        const network =
                            /\b5G\b/i.test(title + ' ' + bodyText)
                                ? '5G mentioned'
                                : '';

                        // Include the feature list as well as the
                        // key-value table in the Excel output.
                        return {
                            name: title,
                            price,
                            originalPrice: originalPriceMatch
                                ? originalPriceMatch[0].trim()
                                : '',
                            discount,
                            rating,
                            battery,
                            ramStorage,
                            display,
                            camera,
                            processor,
                            operatingSystem,
                            network,
                            features: [...new Set(features)].join(' | '),
                            specifications: Object.entries(
                                specifications
                            )
                                .map(([key, value]) =>
                                    `${key}: ${value}`
                                )
                                .join(' | '),
                            url
                        };
                    },
                    {
                        listingText: product.listingText,
                        url: product.url
                    }
                );

                results.push(mobile);
                console.log("------------------------------------");
                console.log('Phone:', mobile.name);
                console.log('Price:', mobile.price);
                console.log('Battery:', mobile.battery);

                // Small delay between product pages
                await detailPage.waitForTimeout(800);

            } catch (error) {
                console.log(
                    `Failed to scrape ${product.url}: ${error.message}`
                );
            }
        }

        await detailPage.close();

        // 9. Create Excel workbook
        const workbook = new ExcelJS.Workbook();

        workbook.creator = 'Playwright Mobile Scraper';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet(
            'Mobile Details'
        );

        // 10. Define Excel columns
        worksheet.columns = [
            { header: 'Phone Name', key: 'name', width: 40 },
            { header: 'Price', key: 'price', width: 16 },
            {
                header: 'Original Price',
                key: 'originalPrice',
                width: 18
            },
            { header: 'Discount', key: 'discount', width: 15 },
            { header: 'Rating', key: 'rating', width: 12 },
            { header: 'Battery', key: 'battery', width: 18 },
            {
                header: 'RAM / Storage',
                key: 'ramStorage',
                width: 24
            },
            { header: 'Display', key: 'display', width: 18 },
            { header: 'Camera', key: 'camera', width: 18 },
            { header: 'Processor', key: 'processor', width: 30 },
            {
                header: 'Operating System',
                key: 'operatingSystem',
                width: 20
            },
            { header: 'Network', key: 'network', width: 18 },
            { header: 'Features', key: 'features', width: 60 },
            {
                header: 'Specifications',
                key: 'specifications',
                width: 80
            },
            { header: 'Product URL', key: 'url', width: 25 }
        ];

        // 11. Insert product rows
        for (const mobile of results) {
            worksheet.addRow(mobile);
        }

        // 12. Style header row
        const header = worksheet.getRow(1);

        header.font = {
            bold: true,
            color: { argb: 'FFFFFFFF' }
        };

        header.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1565C0' }
        };

        header.alignment = {
            vertical: 'middle',
            horizontal: 'center',
            wrapText: true
        };

        header.height = 25;

        // 13. Add clickable product hyperlinks
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;

            const urlCell = row.getCell('url');
            const url = urlCell.value;

            if (
                typeof url === 'string' &&
                /^https?:\/\//i.test(url)
            ) {
                urlCell.value = {
                    text: 'Open Product',
                    hyperlink: url
                };

                urlCell.font = {
                    color: { argb: 'FF0563C1' },
                    underline: true
                };
            }

            row.alignment = {
                vertical: 'top',
                wrapText: true
            };
        });

        // 14. Add filters and freeze header
        worksheet.autoFilter = {
            from: 'A1',
            to: 'O1'
        };

        worksheet.views = [
            {
                state: 'frozen',
                ySplit: 1
            }
        ];

        // 15. Save Excel file
        await workbook.xlsx.writeFile('mobiles.xlsx');

        console.log(
            `\nSuccessfully saved ${results.length} mobiles.`
        );

        console.log('Excel file: mobiles.xlsx');

        // 16. Keep browser open until Enter is pressed
        console.log(
            'Press Enter in the terminal to close the browser.'
        );

        await new Promise(resolve => {
            process.stdin.resume();
            process.stdin.once('data', resolve);
        });

    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error('Scraping failed:', error);
    process.exitCode = 1;
});
