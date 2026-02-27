const EmailService = require('../services/MailService');
const OpenCage = require('../utils/OpenCage');
const Countries = require('../utils/Countries');
const Telecom = require('../utils/Telecom');

// Helper: Verify Cloudflare Turnstile
async function verifyTurnstile(token, ip) {
    if (!token) return false;
    try {
        const formData = new FormData();
        formData.append('secret', process.env.TURNSTILE_SECRET_KEY);
        formData.append('response', token);
        formData.append('remoteip', ip);
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { body: formData, method: 'POST' });
        const data = await res.json();
        return data.success;
    } catch (e) {
        return false;
    }
}

module.exports = {

    register: async function (req, reply) {

        const name = req.postFilter.strip(req.body.name);
        const email = req.postFilter.strip(req.body.email);
        const password = req.body.password;
        const confirm = req.body.confirm;
        const company = req.postFilter.strip(req.body.org);
        const terms = req.postFilter.strip(req.body.termsCheckbox);
        const referrer = req.postFilter.strip(req.body.referrer);

        const captchaToken = req.body['cf-turnstile-response'];
        const fingerprint = req.postFilter.strip(req.body.fingerprint);

        // 3. Security Checks
        if (!fingerprint || fingerprint === 'unknown') {
            return reply.code(400).send({ status: 400, error: req.t('invalid_fingerprint') });
        }

        const isHuman = await verifyTurnstile(captchaToken, req.ip);
        if (!isHuman) {
            return reply.code(400).send({ status: 400, error: req.t('security_check_failed') });
        }

        if (!name || req.postFilter.validateName(name) === false) return reply.code(400).send({ status: 400, error: req.t('please_provide_full_name') });
        if (!email || !email.includes('@') || req.postFilter.validateEmail(email) === false) return reply.code(400).send({ status: 400, error: req.t('invalid_email') });
        if (!password) return reply.code(400).send({ status: 400, error: req.t('please_provide_password') });
        if (password !== confirm) return reply.code(400).send({ status: 400, error: req.t('passwords_do_not_match') });
        if (terms !== 'on' && terms !== 'accept') return reply.code(400).send({ status: 400, error: req.t('please_accept_terms') });

        const identity = req.postFilter.getDevice(req);
        identity.fingerprint = fingerprint;

        try {
            const result = await req.auth.register(name, email, password, company, identity, referrer);

            if (result.status) {
                const link = `${process.env.APP_DOMAIN}/email/verify/${result.code}`;

                const emailHtml = await req.server.view('email/general.ejs', {
                    t: req.t,
                    logo: `${process.env.APP_DOMAIN}/public/ui/images/logo/logo-dark.png`,
                    title: req.t('email.verify_title'),
                    message: req.t('email.verify_body', { name: name }),
                    link: link,
                    btn_text: req.t('email.verify_btn'),
                    footer: req.t('email.footer', { year: new Date().getFullYear(), app_name: process.env.APP_NAME })
                });

                const mailer = new EmailService(req.t('email.subject_verify'), email, emailHtml);
                await mailer.SMTP();

                const modalHtml = await req.server.view('modal/note.ejs', {
                    t: req.t,
                    title: req.t('registration_successful'),
                    message: req.t('please_check_email')
                });

                return reply.send({
                    status: 200,
                    message: 'Success',
                    base: `${process.env.APP_DOMAIN}/`,
                    modal: modalHtml
                });

            } else {
                return reply.code(400).send({ status: 400, error: req.t(result.error) });
            }

        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({ status: 500, error: req.t('server_error') });
        }
    },

    login: async function (req, reply) {
        const username = req.postFilter.strip(req.body.email);
        const password = req.body.password;
        const requestUrl = req.postFilter.strip(req.body.requestUrl);
        const fingerprint = req.postFilter.strip(req.body.fingerprint);
        const captchaToken = req.body['cf-turnstile-response'];

        if (!fingerprint) return reply.code(400).send({ status: 400, error: req.t('invalid_fingerprint') });
        if (!username || !password) return reply.code(400).send({ status: 400, error: req.t('invalid_credentials') });

        const device = req.postFilter.getDevice(req);
        device.fingerprint = fingerprint;

        const isHuman = await verifyTurnstile(captchaToken, req.ip);
        if (!isHuman) {
            return reply.code(400).send({ status: 400, error: req.t('security_check_failed') });
        }

        try {
            const result = await req.auth.login(username, password, device);

            if (result.status) {
                reply.setCookie('ziondefi_session', result.token, {
                    path: '/',
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: result.maxAge
                });

                let redirect = '/home';
                if (requestUrl && requestUrl.startsWith(process.env.APP_DOMAIN)) redirect = requestUrl;

                return reply.send({ status: 200, redirect: redirect });

            } else {
                if (result.locked) return reply.code(401).send({ status: 401, error: req.t('account_locked') });
                if (result.review) return reply.code(401).send({ status: 401, error: req.t('account_inactive') });
                return reply.code(401).send({ status: 401, error: req.t(result.error) });
            }
        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({ status: 500, error: req.t('server_error') });
        }
    },

    onboarding: async function (req, reply) {
        if (!req.user) return reply.code(401).send({ status: 401, error: req.t('unauthorized') });

        try {

            const { dun_number, business_name, business_address, business_phone, business_email, dob, gender, country, purpose } = req.body;

            const sanitizedDob = req.postFilter.strip(dob);
            const sanitizedCountry = req.postFilter.strip(country);
            const sanitizedPurpose = req.postFilter.strip(purpose);
            const sanitizedGender = req.postFilter.strip(gender);

            if (!sanitizedDob || !sanitizedCountry || !sanitizedPurpose) {
                return reply.code(400).send({ status: 400, error: req.t('missing_required_fields') });
            }

            const captchaToken = req.body['cf-turnstile-response'];
            const isHuman = await verifyTurnstile(captchaToken, req.ip);
            if (!isHuman) {
                //return reply.code(400).send({ status: 400, error: req.t('security_check_failed') });
            }

            const age = new Date().getFullYear() - new Date(sanitizedDob).getFullYear();
            if (age < 16) return reply.code(400).send({ status: 400, error: req.t('must_be_16') });

            if (['north korea', 'iran'].includes(sanitizedCountry.toLowerCase())) {
                return reply.code(400).send({ status: 400, error: req.t('country_not_supported') });
            }
            
            if(sanitizedGender && !['male', 'female', 'other', 'prefer not to say'].includes(sanitizedGender.toLowerCase())) {
                return reply.code(400).send({ status: 400, error: req.t('invalid_gender') });
            }

            let businessInfo = {};
            if (dun_number || business_name || business_address || business_phone || business_email) {
                
                const sanitizedBusinessEmail = req.postFilter.strip(business_email);
                const sanitizedBusinessName = req.postFilter.strip(business_name);
                const sanitizedBusinessAddress = req.postFilter.strip(business_address);
                const sanitizedBusinessPhone = req.postFilter.strip(business_phone);
                const sanitizedDunNumber = req.postFilter.strip(dun_number);

                if (!sanitizedDunNumber) return reply.code(400).send({ status: 400, error: req.t('dun_number_required') });
                if (!sanitizedBusinessName) return reply.code(400).send({ status: 400, error: req.t('business_name_required') });
                if (!sanitizedBusinessAddress) return reply.code(400).send({ status: 400, error: req.t('business_address_required') });
                if (!sanitizedBusinessPhone) return reply.code(400).send({ status: 400, error: req.t('business_phone_required') });
                if (!sanitizedBusinessEmail || !sanitizedBusinessEmail.includes('@') || req.postFilter.validateEmail(sanitizedBusinessEmail) === false) return reply.code(400).send({ status: 400, error: req.t('invalid_business_email') });

                //DUNS number must be 9 digits
                if (!/^\d{9}$/.test(sanitizedDunNumber)) {
                    return reply.code(400).send({ status: 400, error: req.t('invalid_dun_number') });
                }

                const countryData = Countries.getByName(sanitizedCountry);
                if (!countryData) {
                    return reply.code(400).send({ status: 400, error: req.t('invalid_country') });
                }

                const telecom = new Telecom(sanitizedBusinessPhone, countryData.iso);
                const resultPhone = await telecom.phoneInfo();

                // 3. Check if valid
                if (!resultPhone.status || !resultPhone.response.isValidNumber) {
                    return reply.code(400).send({ 
                        status: 400, 
                        error: telecom.phoneInfo()['message'] 
                    });
                }

                businessInfo = {
                    name: sanitizedBusinessName,
                    email: sanitizedBusinessEmail,
                    phone: resultPhone.response,
                    dun_number: sanitizedDunNumber,
                    business_address: sanitizedBusinessAddress
                };

                const validation = await OpenCage.validateAddress(sanitizedBusinessAddress);

                let retryValidationCount = req.user.address_validation_attempts || 0;

                if (!validation.isValid && retryValidationCount < 3) {
                    if (retryValidationCount < 3) {
                        await req.auth.incrementAddressValidationAttempts(req.user.user_id);
                    }

                    return reply.code(400).send({
                        status: 400,
                        error: req.t(validation.error)
                    });
                }

                if (validation.isValid) {
                    const { components, geometry, timezone } = validation;
                    
                    businessInfo.business_address = {
                        raw: sanitizedBusinessAddress,
                        formatted: validation.formatted,
                        city: components.city || components.town || components.village,
                        state: components.state,
                        zip: components.postcode,
                        country: components.country,
                        location: {
                            type: 'Point',
                            coordinates: [geometry.lng, geometry.lat]
                        },
                        timezone: timezone.name,
                        timezone_offset: timezone.offset_string
                    };
                }
            }

            const result = await req.auth.onboarding(req.user.user_id, businessInfo, sanitizedDob, sanitizedGender, sanitizedCountry, sanitizedPurpose);

            if (result.status) {
                const modalHtml = await req.server.view('modal/note.ejs', {
                    t: req.t,
                    title: req.t('onboarding_complete'),
                    message: req.t('account_ready')
                });
                return reply.send({ status: 200, message: req.t('success'), modal: modalHtml });
            } else {
                return reply.code(400).send({ status: 400, error: req.t(result.error) });
            }
        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({ status: 500, error: req.t('server_error') });
        }
    },

    verifyEmail: async function (req, reply) {
        const { code } = req.params;

        const viewData = {
            app_name: process.env.APP_NAME || 'ZionDefi',
            title: req.t('email_verification'),
            year: new Date().getFullYear(),
            t: req.t
        };

        try {
            const result = await req.auth.verifyEmailProcess(code);

            if (result.status) {
                // SUCCESS
                return reply.view('auth/verify.ejs', {
                    ...viewData,
                    success: true,
                    header: req.t('account_verified'),
                    message: req.t('account_verified_desc'),
                    btn_text: req.t('login_now'),
                    btn_link: '/login',
                    root: process.env.APP_DOMAIN + '/'
                });
            } else {
                // ERROR
                return reply.code(400).view('auth/verify.ejs', {
                    ...viewData,
                    success: false,
                    header: req.t('verification_failed'),
                    message: req.t(result.error),
                    btn_text: req.t('back_to_home'),
                    btn_link: '/',
                    root: process.env.APP_DOMAIN + '/'
                });
            }

        } catch (err) {
            req.log.error(err);
            return reply.code(500).view('auth/verify.ejs', {
                ...viewData,
                success: false,
                header: req.t('server_error'),
                message: req.t('try_again_later'),
                btn_text: req.t('contact_support'),
                btn_link: '/support',
                root: process.env.APP_DOMAIN + '/'
            });
        }
    },

    loginWallet: async function (req, reply) {
        const { address, signature, typedData, wallet_id, publicKey } = req.body;

        const captchaToken = req.body['cf-turnstile-response'];

        if (!address || !signature || !typedData) {
            return reply.code(400).send({ status: 400, error: req.t('wallet_connection_failed') });
        }

        const isHuman = await verifyTurnstile(captchaToken, req.ip);
        if (!isHuman) {
            //return reply.code(400).send({ status: 400, error: req.t('security_check_failed') });
        }

        const device = req.postFilter.getDevice(req);
        device.fingerprint = address.toLowerCase();
        device.wallet_provider = wallet_id;

        try {
            const result = await req.auth.loginWithWallet(address, signature, typedData, device);

            if (result.status) {
                reply.setCookie('ziondefi_session', result.token, {
                    path: '/',
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: 1800
                });
                return reply.send({ status: 200, redirect: '/home' });
            } else {
                return reply.code(401).send({ status: 401, error: req.t(result.error) });
            }
        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({ status: 500, error: req.t('server_error') });
        }
    },

    showLogin: async (req, reply) => {
        if (req.user) return reply.redirect('/home');
        return reply.view('auth/login.ejs', {
            app_name: process.env.APP_NAME || 'ZionDefi',
            title: req.t('auth.title', { app_name: process.env.APP_NAME }),
            root: '/',
            termsLink: '/terms',
            privacyLink: '/privacy',
        });
    },

    showRegister: async (req, reply) => {
        if (req.user) return reply.redirect('/home');

        return reply.view('auth/register.ejs', {
            app_name: process.env.APP_NAME || 'ZionDefi',
            title: req.t('register.title', { app_name: process.env.APP_NAME }),
            termsLink: '/terms',
            privacyLink: '/privacy',
            root: '/'
        });
    },

    showOnboarding: async (req, reply) => {
        const countryList = Countries.getAll();

        return reply.view('auth/onboarding.ejs', {
            app_name: process.env.APP_NAME || 'ZionDefi',
            countries: countryList,
            termsLink: '/terms',
            privacyLink: '/privacy',
            root: '/'
        });
    },

    logout: async (req, reply) => {
        reply.clearCookie('ziondefi_session', { path: '/' });
        return reply.view('auth/login.ejs', {
            app_name: process.env.APP_NAME || 'ZionDefi',
            title: req.t('auth.title', { app_name: process.env.APP_NAME }),
            root: '/',
            termsLink: '/terms',
            privacyLink: '/privacy',
        });
    }
};