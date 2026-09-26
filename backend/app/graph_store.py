import networkx as nx

class GraphStore:
    def __init__(self):
        self.graph = nx.DiGraph()
        
    def add_entities_and_relations(self, data: dict):
        """
        Populate the graph with entities and relationships from a dictionary.
        """
        entities = data.get("entities", [])
        relations = data.get("relations", [])
        
        for entity in entities:
            self.graph.add_node(entity["id"], name=entity["name"], type=entity["type"])
            
        for relation in relations:
            # NetworkX automatically creates nodes if they don't exist when adding edges
            self.graph.add_edge(relation["source"], relation["target"], type=relation["type"])
            
    def get_neighbors(self, node_id: str, hops: int = 1):
        """
        Get neighbors of a node up to `hops` distance.
        """
        if node_id not in self.graph:
            return []
            
        # Converting to undirected for simpler bidirectional neighborhood traversal
        undirected_g = self.graph.to_undirected()
        neighbors = set()
        
        current_layer = {node_id}
        for _ in range(hops):
            next_layer = set()
            for node in current_layer:
                next_layer.update(undirected_g.neighbors(node))
            neighbors.update(next_layer)
            current_layer = next_layer
            
        # Remove self
        if node_id in neighbors:
            neighbors.remove(node_id)
            
        return list(neighbors)

    def find_nodes_by_name(self, substring: str):
        """
        Search for nodes matching a substring (case-insensitive).
        """
        substring = substring.lower()
        matched = []
        for node, data in self.graph.nodes(data=True):
            if "name" in data and substring in data["name"].lower():
                matched.append({"id": node, **data})
        return matched
        
    def to_json(self):
        """
        Export the graph to a JSON format suitable for frontend visualization (e.g., node-link).
        """
        return {
            "nodes": [{"id": node_id, **data} for node_id, data in self.graph.nodes(data=True)],
            "links": [{"source": source, "target": target, **data}
                      for source, target, data in self.graph.edges(data=True)],
        }
