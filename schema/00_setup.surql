-- Namespace and database
DEFINE NAMESPACE IF NOT EXISTS microbots;
DEFINE DATABASE IF NOT EXISTS memory;

-- Full-text search analyzers
DEFINE ANALYZER chat_analyzer
    TOKENIZERS blank, class
    FILTERS lowercase, snowball(english);

DEFINE ANALYZER memory_analyzer
    TOKENIZERS blank, class
    FILTERS lowercase, snowball(english);
