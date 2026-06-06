## ADDED Requirements

### Requirement: GPT-compatible token counting and truncation
The system SHALL count tokens and truncate text to fit within GPT token budgets.

#### Scenario: Token count returns number
- **WHEN** calling `tokenizer.count("hello world")`
- **THEN** it SHALL return the number of GPT tokens

#### Scenario: Truncate to max tokens
- **WHEN** calling `tokenizer.truncate(text, 50)`
- **THEN** it SHALL truncate text to approximately 50 tokens, preferring word boundaries
