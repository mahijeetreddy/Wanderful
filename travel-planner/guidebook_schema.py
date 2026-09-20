from __future__ import annotations

from pydantic import BaseModel, Field


class GuidebookContent(BaseModel):
    overview: str = ""
    currency_code: str = ""
    currency_notes: str = ""
    language_basics: list[str] = Field(default_factory=list)
    local_customs: list[str] = Field(default_factory=list)
    safety_tips: list[str] = Field(default_factory=list)
    packing_notes: list[str] = Field(default_factory=list)
    transport_tips: list[str] = Field(default_factory=list)
