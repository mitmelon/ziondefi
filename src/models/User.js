const MongoBase = require('../lib/MongoBase');

class User extends MongoBase {
    constructor(mongoClient) {
        // 1. Hardcode DB and Collection Name here ONCE
        super(mongoClient, process.env.MONGO_DB, 'users', {
            email: true,
            username: true,
            company: 1,
            account_type: 1
        });

        // 2. Configure Encryption here ONCE
        /***
        this.enableEncryption(
            ['name', 'email', 'username', 'company', 'account_type', 'security'], 
            'user_master_key',               
            ['email', 'username', 'company', 'account_type', 'security']                               
        );
        **/
    }

    async findByEmail(email) {
        // Email is plain text in your logic, so standard find
        return await this.findOne({ email: email });
    }
}

module.exports = User;