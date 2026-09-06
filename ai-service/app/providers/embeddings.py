"""Embedding providers for semantic skill matching.

Default is `LocalEmbeddingProvider`: a deterministic character n-gram hashing
vectoriser blended with the curated skill ontology. It is NOT a neural model and
we do not call it one - it is a fast lexical+ontology similarity that runs
offline with zero install.

`SentenceTransformerProvider` is used only if the optional `sentence-transformers`
package is installed (it pulls in PyTorch, ~2 GB, which is a poor default for a
hackathon checkout). Both expose the same interface, so switching is one env var.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
from abc import ABC, abstractmethod

from ..config import get_settings
from ..services.extractors import canonicalize, related_terms

log = logging.getLogger("ai.embeddings")

DIM = 256


class EmbeddingProvider(ABC):
    name = "base"
    is_neural = False

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        ...

    def similarity(self, a: str, b: str) -> float:
        va, vb = self.embed([a, b])
        return cosine(va, vb)


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return max(0.0, min(1.0, dot / (na * nb)))


class LocalEmbeddingProvider(EmbeddingProvider):
    """Hashed character-trigram vectoriser. Deterministic, offline, ~microseconds."""

    name = "local-lexical"
    is_neural = False

    def _tokens(self, text: str) -> list[str]:
        clean = re.sub(r"[^a-z0-9+#./ ]", " ", str(text or "").lower())
        words = [w for w in clean.split() if w]
        grams: list[str] = list(words)
        for word in words:
            padded = f"^{word}$"
            grams.extend(padded[i : i + 3] for i in range(max(len(padded) - 2, 1)))
        return grams

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            vec = [0.0] * DIM
            tokens = self._tokens(text)
            for token in tokens:
                h = int(hashlib.md5(token.encode("utf-8")).hexdigest()[:8], 16)
                idx = h % DIM
                sign = 1.0 if (h >> 8) & 1 else -1.0
                # Whole words carry more weight than character trigrams.
                vec[idx] += sign * (2.0 if len(token) > 3 and " " not in token and not token.startswith("^") else 1.0)
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            vectors.append([v / norm for v in vec])
        return vectors


class SentenceTransformerProvider(EmbeddingProvider):
    """Optional neural embeddings. Only used when the package is installed."""

    name = "sentence-transformers"
    is_neural = True

    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415 - optional dep

        self.model = SentenceTransformer(model_name)
        self.model_name = model_name

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [list(map(float, v)) for v in self.model.encode(texts, normalize_embeddings=True)]


_provider: EmbeddingProvider | None = None


def get_embedding_provider() -> EmbeddingProvider:
    global _provider  # noqa: PLW0603
    if _provider is not None:
        return _provider

    s = get_settings()
    if s.embedding_provider == "sentence-transformers":
        try:
            _provider = SentenceTransformerProvider(s.embedding_model)
            log.info("Using neural embeddings: %s", s.embedding_model)
            return _provider
        except Exception as exc:  # noqa: BLE001 - optional dependency, any failure degrades
            log.warning("sentence-transformers unavailable (%s) - using local lexical embeddings", exc)

    _provider = LocalEmbeddingProvider()
    return _provider


def semantic_skill_similarity(required: str, offered: str) -> float:
    """Similarity in [0,1] combining canonical identity, ontology and embeddings.

    Order matters: an exact canonical match is certainty, ontology adjacency is
    strong evidence, and the embedding is only a tiebreaker for unknown terms.
    """
    a = canonicalize(required)
    b = canonicalize(offered)
    if a == b:
        return 1.0
    if b in related_terms(a) or a in related_terms(b):
        return 0.6
    sim = get_embedding_provider().similarity(a, b)
    # Lexical similarity alone is weak evidence; cap its contribution.
    return round(min(sim, 0.5), 3)
