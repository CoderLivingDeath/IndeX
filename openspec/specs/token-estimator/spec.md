## ADDED Requirements

### Requirement: Simple token estimation
The system SHALL estimate token count as `ceil(bytes / 4)`.

#### Scenario: Estimate short text
- **WHEN** calling `estimator.estimate("hello")`
- **THEN** it SHALL return approximately 1-2 tokens

#### Scenario: Estimate empty string
- **WHEN** calling `estimator.estimate("")`
- **THEN** it SHALL return 0

### Requirement: Tiktoken-based estimation (optional)
The system SHALL use tiktoken for accurate GPT token counting when available.

#### Scenario: Tiktoken estimate is accurate
- **WHEN** calling `tiktokenEstimator.estimate("hello world")`
- **THEN** it SHALL return the exact GPT token count

#### Scenario: Tiktoken falls back to Simple
- **WHEN** tiktoken is not installed
- **THEN** the estimator SHALL silently fall back to the Simple strategy
