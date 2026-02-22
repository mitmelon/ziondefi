# DEPLOYING STARKNET CONTRACT ON SEPOLIA

# cmd - sncast account create  --network=sepolia --name=sepolia
Success: Account created

# Address: 0x19746066929c8d75eb939dd9288d6ae79d4da95eafc87c623be367d3c0ee345


0x04a1dac4a11a11b1a6f67f9db7aeb295abacbe15e4c322e2fd602b3bb1e2be0a

sncast declare --contract-name=ZionDefiCard --l2-gas 300000000 --l2-gas-price 12000000000

Account successfully created but it needs to be deployed. The estimated deployment fee is 0.008450374549459584 STRK. Prefund the account to cover deployment transaction fee

After prefunding the account, run:
sncast account deploy --network sepolia --name sepolia

----------------------------------------------------------------------------------------------------------------------------------------------------

DECLARE CONTRACT 

# ZionDefiCard Contract

# sncast --account=sepolia declare --contract-name=ZionDefiCard --network=sepolia

Manual Gas 
sncast --account=sepolia declare \
  --contract-name ZionDefiFactory \
  --network=sepolia \
  --l2-gas 5200000000 \
  --l2-gas-price 8000000000 \
  --l1-gas 100 \
  --l1-gas-price 300000000000000 \
  --l1-data-gas 500 \
  --l1-data-gas-price 3000000000000

# Class Hash:        0x5d306c11ebeb026b94755fe656ac130896761020e248b6b40ea6178c6c85200

----------------------------------------------------------------------------------------------------------------------------------------------------

# DEPLOY FOR FACTORY CLASS ZionDefiFactory

sncast --account=sepolia declare --contract-name=ZionDefiFactory --network=sepolia

# Class Hash:         0x5b59880360a0c4e151f6a3ada459589ae82592d125e22ff6e4f9c0a77749c20


sncast --account sepolia deploy --class-hash 0x751544f8253ab284ed2f275e9150b26fe642a16f840231531b733c455c94a25 --arguments '<owner: 0x0559ebec5ff32670562feff2716b2193e59f0d223360ea29b595a0caaf14379d>, <vault_class_hash: 0x152722351337a83fefc793c3a359cd2effc89678339226445f7d13967179613>, <admin_wallet: 0x0559ebec5ff32670562feff2716b2193e59f0d223360ea29b595a0caaf14379d>' --network sepolia

sncast --account sepolia deploy --class-hash 0x751544f8253ab284ed2f275e9150b26fe642a16f840231531b733c455c94a25 --constructor-calldata 0x0559ebec5ff32670562feff2716b2193e59f0d223360ea29b595a0caaf14379d 0x152722351337a83fefc793c3a359cd2effc89678339226445f7d13967179613 0x0559ebec5ff32670562feff2716b2193e59f0d223360ea29b595a0caaf14379d --network sepolia

Success: Deployment completed

## Contract Address: 0x065bc639e04910671f537576971827d516104bc791aaf88b9fd890ce17e6e77c

Transaction Hash: 0x064c041d10ec1bf6a08b1d0ef8120bebbfda9ac5e4b576f61ffdcf6122125c36



//SEPOLIA
node deploy.js upgrade 0x5b59880360a0c4e151f6a3ada459589ae82592d125e22ff6e4f9c0a77749c20


node deploy.js set-vault-hash 0x5d306c11ebeb026b94755fe656ac130896761020e248b6b40ea6178c6c85200 --testnet


# ETH
node deploy.js add-token 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7 19514442401534788 --testnet

# STRK
node deploy.js add-token 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d 6004514686061859652 --testnet

# USDC
node deploy.js add-token 0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080 6148332971638477636 --testnet



0xa98de9e9016bb6a9bfbc7ed3a9312eb7735532161a50eccf7de94a0125878c

