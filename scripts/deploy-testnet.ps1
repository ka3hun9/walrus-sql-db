# PowerShell script (run on your machine with Sui CLI installed)
# 1) switch to testnet
sui client switch --env testnet

# 2) publish Move package
sui client publish --gas-budget 100000000 contracts/walrus_sql

# 3) after publish, copy PACKAGE_ID and run SQL planning demo
npm run onchain:plan
