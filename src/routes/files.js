const FileLoader = require('../utils/FileLoader');

async function fileRoutes(fastify, options) {

    // URL Example: https://yoursite.com/files/view/avatar-12345.jpg
    fastify.get('/view/:filename', async (req, reply) => {
        const { filename } = req.params;

        // 1. Ask FileLoader for the stream
        const fileData = await FileLoader.getFileStream(filename);

        if (!fileData) {
            return reply.code(404).send('File not found');
        }

        reply.header('Content-Type', fileData.mime);
        reply.header('Content-Length', fileData.size);
        // Cache for 1 day
        reply.header('Cache-Control', 'public, max-age=86400'); 

        // 3. Send the stream
        return reply.send(fileData.stream);
    });

}

module.exports = fileRoutes;