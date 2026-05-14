import { createServer } from './server.ts';

const app = createServer();

await app.listen({ port: 4000, host: '0.0.0.0' });
console.log(`
╔════════════════════════════════════════╗
║   Servidor de Extração de Documentos   ║
║   Rodando em http://0.0.0.0:4000       ║
╚════════════════════════════════════════╝

📚 Endpoint disponível:
  • POST /extract  - Envie um documento e um prompt de extração/análise

Exemplo de uso:
  curl -X POST \\
    -F "file=@documento.pdf" \\
    -F "prompt=Extraia os dados visíveis e retorne somente JSON válido." \\
    -F "document_type=documento" \\
    http://localhost:4000/extract
`);
