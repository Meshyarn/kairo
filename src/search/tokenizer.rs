use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, NgramTokenizer, RemoveLongFilter, SimpleTokenizer,
    TextAnalyzer, Token, TokenStream, Tokenizer,
};

/// Register all custom tokenizers with the index
pub fn register_tokenizers(index: &tantivy::Index) {
    let manager = index.tokenizers();

    // code_content: general code text tokenizer
    manager.register(
        "code_content",
        TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(RemoveLongFilter::limit(40))
            .filter(LowerCaser)
            .filter(AsciiFoldingFilter)
            .build(),
    );

    // ngram3: 3-gram for fuzzy matching
    manager.register(
        "ngram3",
        TextAnalyzer::builder(NgramTokenizer::new(3, 3, false).unwrap())
            .filter(LowerCaser)
            .build(),
    );

    // path: path component tokenizer
    manager.register(
        "path",
        TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(LowerCaser)
            .build(),
    );

    // identifier: splits camelCase, snake_case, PascalCase
    manager.register(
        "identifier",
        TextAnalyzer::builder(IdentifierTokenizer)
            .filter(LowerCaser)
            .build(),
    );
}

/// Tokenizer that splits identifiers on case boundaries, underscores, etc.
/// "getUserName" -> ["get", "user", "name"]
/// "HTTP_STATUS_CODE" -> ["http", "status", "code"]
#[derive(Clone)]
struct IdentifierTokenizer;

impl Tokenizer for IdentifierTokenizer {
    type TokenStream<'a> = IdentifierTokenStream;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        let tokens = split_identifier(text);
        IdentifierTokenStream {
            tokens,
            index: 0,
            token: Token::default(),
        }
    }
}

struct IdentifierTokenStream {
    tokens: Vec<(usize, usize, String)>, // (start, end, text)
    index: usize,
    token: Token,
}

impl TokenStream for IdentifierTokenStream {
    fn advance(&mut self) -> bool {
        if self.index >= self.tokens.len() {
            return false;
        }
        let (start, end, ref text) = self.tokens[self.index];
        self.token.offset_from = start;
        self.token.offset_to = end;
        self.token.text.clear();
        self.token.text.push_str(text);
        self.token.position = self.index;
        self.index += 1;
        true
    }

    fn token(&self) -> &Token {
        &self.token
    }

    fn token_mut(&mut self) -> &mut Token {
        &mut self.token
    }
}

/// Split an identifier string into components
fn split_identifier(text: &str) -> Vec<(usize, usize, String)> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut start = 0;
    let mut current = String::new();

    for (i, &ch) in chars.iter().enumerate() {
        if !ch.is_alphanumeric() {
            // Non-alphanumeric: emit current token, skip separator
            if !current.is_empty() {
                tokens.push((start, i, current.clone()));
                current.clear();
            }
            start = i + 1;
            continue;
        }

        let should_split = if current.is_empty() {
            false
        } else {
            let prev = chars[i - 1];
            // lowercase -> UPPERCASE (camelCase boundary)
            (prev.is_lowercase() && ch.is_uppercase())
            // letter -> digit or digit -> letter
            || (prev.is_alphabetic() != ch.is_alphabetic()
                && prev.is_alphanumeric()
                && ch.is_alphanumeric())
        };

        if should_split && !current.is_empty() {
            tokens.push((start, i, current.clone()));
            current.clear();
            start = i;
        }

        current.push(ch);
    }

    if !current.is_empty() {
        tokens.push((start, chars.len(), current));
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_identifier() {
        let cases = vec![
            ("getUserName", vec!["get", "User", "Name"]),
            ("HTTP_STATUS_CODE", vec!["HTTP", "STATUS", "CODE"]),
            ("parseJSON2XML", vec!["parse", "JSON", "2", "XML"]),
            ("simple", vec!["simple"]),
        ];

        for (input, expected) in cases {
            let result: Vec<String> = split_identifier(input).into_iter().map(|t| t.2).collect();
            assert_eq!(result, expected, "Failed for input: {}", input);
        }
    }
}
