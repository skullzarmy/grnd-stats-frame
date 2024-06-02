// airstackClient.js
import pkg from "@apollo/client";
const { ApolloClient, InMemoryCache, gql } = pkg;

const client = new ApolloClient({
    uri: "https://api.airstack.xyz/gql",
    cache: new InMemoryCache(),
    headers: {
        Authorization: `Bearer ${process.env.AIRSTACK_API_KEY}`,
    },
});

export { client, gql };
