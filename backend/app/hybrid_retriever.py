import re
from typing import List

def extract_keywords(question: str) -> List[str]:
    """
    Very simple keyword extraction: removes stop words and short tokens.
    """
    stop_words = {"what", "is", "the", "a", "an", "of", "and", "in", "to", "how", "why", "who", "where", "when", "do", "does", "did", "are", "for", "with", "on", "at"}
    words = re.findall(r'\b\w+\b', question.lower())
    keywords = [w for w in words if w not in stop_words and len(w) > 2]
    return keywords

def hybrid_retrieve(question: str, vector_store, graph_store, document_id: str = None, k: int = 4):
    """
    Combines vector retrieval with graph neighbor traversal.
    """
    # 1. Vector Search
    search_kwargs = {"k": k}
    if document_id:
        search_kwargs["filter"] = {"document_id": document_id}
        
    retriever = vector_store.as_retriever(search_kwargs=search_kwargs)
    docs = retriever.invoke(question) # get_relevant_documents is deprecated
    vector_context = "\n\n".join(f"[{i + 1}] {doc.page_content}" for i, doc in enumerate(docs))
    
    # 2. Graph Traversal
    keywords = extract_keywords(question)
    graph_context_lines = []
    
    if graph_store:
        matched_nodes = []
        for kw in keywords:
            matches = graph_store.find_nodes_by_name(kw)
            matched_nodes.extend(matches)
            
        # Deduplicate nodes by id
        seen = set()
        unique_nodes = []
        for n in matched_nodes:
            if n["id"] not in seen:
                seen.add(n["id"])
                unique_nodes.append(n)
                
        # 3. Add neighbor nodes up to 1 hop
        for node in unique_nodes:
            neighbors_ids = graph_store.get_neighbors(node["id"], hops=1)
            neighbor_names = []
            for n_id in neighbors_ids:
                n_data = graph_store.graph.nodes.get(n_id, {})
                n_name = n_data.get("name", n_id)
                n_type = n_data.get("type", "Unknown")
                neighbor_names.append(f"{n_name} ({n_type})")
                
            if neighbor_names:
                graph_context_lines.append(
                    f"- {node.get('name')} ({node.get('type')}) is connected to: {', '.join(neighbor_names)}"
                )
    
    graph_context = "\n".join(graph_context_lines)
    
    # 4. Merge contexts
    combined_context = f"--- Document Text ---\n{vector_context}\n\n"
    if graph_context:
         combined_context += f"--- Graph Relationships ---\n{graph_context}\n"
         
    return combined_context, docs
