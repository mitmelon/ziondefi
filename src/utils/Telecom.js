/**
 * util/Telecom.js
 * Modern wrapper using libphonenumber-js + geo/carrier data
 */

const parsePhoneNumber = require('libphonenumber-js');
// Import the data mappers
const { geocoder, carrier, timezones } = require('libphonenumber-geo-carrier');

class Telecom {
    constructor(phone, countryCode = null) {
        this.phone = phone;
        this.countryCode = countryCode;
        this.instance = null;
        this.error = null;

        try {
            // Parse the number
            // parsePhoneNumber returns undefined if it can't parse at all
            this.instance = parsePhoneNumber(phone, countryCode);
            
            if (!this.instance) {
                this.error = "Could not parse phone number";
            }
        } catch (e) {
            this.error = e.message;
        }
    }

    /**
     * Get full phone info
     * NOTE: This is ASYNC now because Carrier/Geo lookup reads data files.
     */
    async phoneInfo() {
        if (!this.instance) {
            return { status: false, message: this.error || "Invalid phone number format" };
        }

        try {
            const phone = this.instance;

            // 1. Basic Validation
            const isValid = phone.isValid();
            const isPossible = phone.isPossible();

            // 2. Formatting
            const e164 = phone.format('E.164');                 // +12133734253
            const international = phone.format('INTERNATIONAL'); // +1 213 373 4253
            const national = phone.format('NATIONAL');           // (213) 373-4253
            const rfc3966 = phone.getURI();                      // tel:+12133734253

            // 3. Components
            const countryCode = phone.countryCallingCode; // "1"
            const regionCode = phone.country;             // "US"
            const nationalNumber = phone.nationalNumber;  // "2133734253"
            
            // 4. Type (Mobile, Landline, etc.)
            // libphonenumber-js returns: "MOBILE", "FIXED_LINE", "VOIP", etc.
            const typeLabel = phone.getType() || 'UNKNOWN';

            // 5. EXTENDED DATA (Carrier, Geo, Timezone)
            // We use the helper library to look these up
            
            // Carrier (e.g., "Verizon", "Vodafone")
            // Returns null if not found (e.g. landlines often have no carrier name)
            const carrierName = await carrier(phone);

            // Location (e.g., "Los Angeles, CA" or "United Kingdom")
            const locationName = await geocoder(phone);

            // Timezone (e.g., "America/Los_Angeles")
            // Returns an array, we pick the first one
            const tzList = await timezones(phone);
            const primaryTimezone = (tzList && tzList.length > 0) ? tzList[0] : null;

            return {
                status: true,
                response: {
                    number: e164,
                    international_number: international,
                    national_number: national,
                    readable_number: rfc3966,
                    
                    countryCode: countryCode.toString(),
                    region: regionCode,
                    local_format: nationalNumber.toString(),
                    
                    isPossible: isPossible,
                    isValidNumber: isValid,
                    type: typeLabel.toUpperCase(),
                    
                    carrier: carrierName || 'Unknown',
                    timezone: primaryTimezone || 'Unknown',
                    location: locationName || 'Unknown',
                    
                    isDialable: isValid
                }
            };

        } catch (error) {
            console.error("Telecom Error:", error);
            return { status: false, message: "Error processing phone data" };
        }
    }
}

module.exports = Telecom;