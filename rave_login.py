import json
from pymongo import MongoClient

def retrieve_and_remove_documents(database_name, collection_name, num_documents=150, output_file='retrieved_documents.json'):
    # Connect to MongoDB
    client = MongoClient('mongodb+srv://raku:raku1234@cluster0.7dhk4es.mongodb.net/?retryWrites=true&w=majority')
    
    # Select the database and collection
    db = client[database_name]
    collection = db[collection_name]
    
    # Retrieve documents from the collection
    documents = collection.find().limit(num_documents)
    
    # Create a list to store the retrieved documents
    retrieved_documents = list(documents)
    
    # Remove the "password" field from each document
    # for document in retrieved_documents:
    #     if "password" in document:
    #         del document["password"]
    
    # Save the retrieved documents to a JSON file
    with open(output_file, 'w') as json_file:
        json.dump(retrieved_documents, json_file, default=str)
    
    # # Remove the retrieved documents from the collection
    # for document in retrieved_documents:
    #     collection.delete_one({'_id': document['_id']})
    
    # # Close the MongoDB connection
    client.close()
    
    return retrieved_documents

# Example usage
database_name = 'google_creda2'
collection_name = 'data23loo'
num_documents = 500

retrieved_documents = retrieve_and_remove_documents(database_name, collection_name, num_documents)

# Print or process the retrieved documents as needed
print("Retrieved and removed documents:")
for doc in retrieved_documents:
    print(doc)

# The documents (without the "password" field) are also saved to a JSON file named 'retrieved_documents.json'