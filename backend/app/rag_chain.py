import time
from .model_client import ConfiguredEmbeddings, generate_text
from langchain_core.prompts import PromptTemplate
from .hybrid_retriever import hybrid_retrieve
from .vector_store import get_vector_store

def calculate_relevance(question: str, context: str) -> float | None:
    if not context.strip():
        return 0.0
    try:
        embeddings = ConfiguredEmbeddings()
        q_emb = embeddings.embed_query(question)
        # Grab first 4000 characters of context to prevent context limits during embedding
        c_emb = embeddings.embed_documents([context[:4000]])[0]
        
        # Calculate cosine similarity
        dot_product = sum(a * b for a, b in zip(q_emb, c_emb))
        mag_q = sum(a * a for a in q_emb) ** 0.5
        mag_c = sum(b * b for b in c_emb) ** 0.5
        if mag_q == 0 or mag_c == 0:
            return 0.0
        return dot_product / (mag_q * mag_c)
    except Exception:
        return None  # Unavailable measurement; never manufacture a relevance score.

def ask_question_hybrid(question: str, document_id: str = None, graph_store=None):
    """
    Answers a question using hybrid context (vector + graph) instead of simple RetrievalQA,
    while measuring performance metrics and context relevance.
    """
    vector_store = get_vector_store()
    
    # 1. Retrieve hybrid context and measure latency
    retrieval_start = time.time()
    combined_context, source_docs = hybrid_retrieve(question, vector_store, graph_store, document_id=document_id, k=4)
    retrieval_latency = time.time() - retrieval_start
    
    # 2. Compute semantic relevance
    relevance_score = calculate_relevance(question, combined_context)
    
    # 3. Prompt and invoke LLM, measuring latency
    
    prompt_template = """Use the following pieces of context to answer the question at the end. 
The context includes both text chunks and extracted graph relationships.
If you don't know the answer based on the context, just say that you don't know, don't try to make up an answer.

Context:
{context}

Question: {question}
Answer in Markdown. Cite the numbered document passages with [1], [2], etc.\nOnly cite a passage if it supports the claim. Never invent citation numbers.\nHelpful Answer:"""
    
    prompt = PromptTemplate(
        template=prompt_template, input_variables=["context", "question"]
    )
    
    formatted_prompt = prompt.format(context=combined_context, question=question)
    
    llm_start = time.time()
    response = generate_text(formatted_prompt, role="answer")
    llm_latency = time.time() - llm_start
    
    return {
        "result": response,
        "source_documents": source_docs,
        "hybrid_context": combined_context,
        "metrics": {
            "retrieval_latency": retrieval_latency,
            "llm_latency": llm_latency,
            "relevance_score": relevance_score
        }
    }

