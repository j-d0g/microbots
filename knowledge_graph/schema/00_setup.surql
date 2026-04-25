-- Namespace and database
DEFINE NAMESPACE OVERWRITE microbots;
DEFINE DATABASE OVERWRITE memory;

-- Full-text search analyzers
DEFINE ANALYZER OVERWRITE chat_analyzer
    TOKENIZERS blank, class
    FILTERS lowercase, snowball(english);

DEFINE ANALYZER OVERWRITE memory_analyzer
    TOKENIZERS blank, class
    FILTERS lowercase, snowball(english);
