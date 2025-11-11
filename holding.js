async function getHoldings(jwtToken, clientCode) {
    try {
        const holdingsUrl = `${BASE_URL}/secure/angelbroking/portfolio/v1/getHolding`;

        const response = await axios.get(holdingsUrl, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'Application/json',
                'X-API-KEY': API_KEY,
                'Authorization': `Bearer ${jwtToken}`, // Use the JWT token here
                'X-ClientLocalIP': 'YOUR_LOCAL_IP', // Replace with client local IP
                'X-ClientPublicIP': 'YOUR_PUBLIC_IP', // Replace with client public IP
                'X-MACAddress': 'YOUR_MAC_ADDRESS', // Replace with client MAC address
                'X-UserType': 'USER',
                'X-SourceID': 'WEB',
            }
        });

        console.log("Holdings data retrieved successfully:");
        return response.data.data; // The actual portfolio data
    } catch (error) {
        console.error("Failed to retrieve holdings:", error.response ? error.response.data : error.message);
        throw new Error("Could not get portfolio data");
    }
}

// Main execution flow
async function main() {
    try {
        const { jwtToken } = await loginAndGetTokens();
        const portfolioHoldings = await getHoldings(jwtToken, CLIENT_CODE);
        console.log(JSON.stringify(portfolioHoldings, null, 2));
    } catch (error) {
        console.error("An error occurred during the process:", error.message);
    }
}

main();
