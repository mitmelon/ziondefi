module.exports = {
    index: async (req, reply) => {
        return reply.view('index.ejs', { 
            title: 'Welcome to ZionDefi',
            user: null // Public page, no user data needed usually
        });
    }
};