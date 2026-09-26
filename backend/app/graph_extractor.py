import json
from pydantic import BaseModel
from langchain_core.prompts import PromptTemplate
from .model_client import generate_text

class Entity(BaseModel):
    id: str
    name: str
    type: str

class Relation(BaseModel):
    source: str
    target: str
    type: str

class GraphData(BaseModel):
    entities: list[Entity]
    relations: list[Relation]

def extract_graph_from_text(text: str) -> dict:
    """Extract and validate graph JSON using the configured graph profile."""
    prompt = PromptTemplate(
        input_variables=["text"],
        template="""Extract entities and relationships from this text.
Return ONLY a valid JSON object matching this exact schema, with no other text, markdown formatting, or preamble:
{{
  "entities": [
    {{"id": "E1", "name": "Entity Name", "type": "Concept"}}
  ],
  "relations": [
    {{"source": "E1", "target": "E2", "type": "RELATES_TO"}}
  ]
}}

TEXT TO ANALYZE:
{text}"""
    )
    
    
    try:
        content = generate_text(prompt.format(text=text), role="graph").strip()
        
        # Clean markdown code blocks if the model insists on adding them
        if content.startswith("```json"):
            content = content.replace("```json", "", 1)
        if content.startswith("```"):
            content = content.replace("```", "", 1)
        if content.endswith("```"):
            content = content[:-3]
            
        data = json.loads(content.strip())
        validated = GraphData.model_validate(data)
        ids = {entity.id for entity in validated.entities}
        if any(relation.source not in ids or relation.target not in ids for relation in validated.relations):
            raise ValueError("A relationship refers to an unknown entity")
        return validated.model_dump()
    except Exception:
        raise RuntimeError("Graph extraction failed. Check the graph model configuration and JSON output.") from None
