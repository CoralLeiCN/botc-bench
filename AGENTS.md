# Repository source-provenance rules

These rules apply to every contributor and automation working in this repository.

1. Every script, game-rule document, and FAQ/Q&A document must keep its original source URL(s) in a `reference/` subdirectory owned by the same content directory.
   - Script-specific material: `scripts/<script-id>/reference/`
   - The script index: `scripts/reference/`
   - Root-level rule documents: `reference/`
2. Prefer first-party sources from The Pandemonium Institute (TPI): the official website, official Wiki, and repositories under `github.com/ThePandemoniumInstitute`.
3. Keep canonical English and any official translation side by side. Never replace official wording with an unlabelled paraphrase or an in-house translation.
4. Clearly label summaries, interpretations, local rulings, and homebrew content. They must not be presented as official text.
5. When a generated data file contains official material, keep a reproducible generator plus the exact upstream URLs and retrieval date in that file or its adjacent `reference/` directory.
6. After changing a Markdown script, rule, or FAQ, run `python3 tools/update_reference_links.py` and commit the updated reference indexes.
