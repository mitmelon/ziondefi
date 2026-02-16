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
  --contract-name ZionDefiCard \
  --network=sepolia \
  --l2-gas 5200000000 \
  --l2-gas-price 8000000000 \
  --l1-gas 100 \
  --l1-gas-price 300000000000000 \
  --l1-data-gas 500 \
  --l1-data-gas-price 3000000000000

# Class Hash:       0x73425b9fca8013433bb7b2e8825ec7093cbdc7f58c0298adcc9fbe446bb2167

# Transaction Hash: 0x37b0879959673fde72d9c609f50f67613d1cee0768e9ce45b8264b6f7e5fa2


----------------------------------------------------------------------------------------------------------------------------------------------------

# DEPLOY FOR FACTORY CLASS ZionDefiFactory

sncast --account=sepolia declare --contract-name=ZionDefiFactory --network=sepolia

# Class Hash:       0x751544f8253ab284ed2f275e9150b26fe642a16f840231531b733c455c94a25

# Transaction Hash: 0x2662b0a7d5c39b3dd88917b984967c0b75dffb779260fc2ad380dd2796b44c

sncast --account sepolia deploy --class-hash 0x751544f8253ab284ed2f275e9150b26fe642a16f840231531b733c455c94a25 --arguments '<owner: 0x0559ebec5ff32670562feff2716b2193e59f0d223360ea29b595a0caaf14379d>, <vault_class_hash: 0x152722351337a83fefc793c3a359cd2effc89678339226445f7d13967179613>, <admin_wallet: 0x0559ebec5ff32670562feff2716b2193e59f0d223360ea29b595a0caaf14379d>' --network sepolia

sncast --account sepolia deploy --class-hash 0x751544f8253ab284ed2f275e9150b26fe642a16f840231531b733c455c94a25 --constructor-calldata 0x0559ebec5ff32670562feff2716b2193e59f0d223360ea29b595a0caaf14379d 0x152722351337a83fefc793c3a359cd2effc89678339226445f7d13967179613 0x0559ebec5ff32670562feff2716b2193e59f0d223360ea29b595a0caaf14379d --network sepolia

Success: Deployment completed

## Contract Address: 0x065bc639e04910671f537576971827d516104bc791aaf88b9fd890ce17e6e77c

Transaction Hash: 0x064c041d10ec1bf6a08b1d0ef8120bebbfda9ac5e4b576f61ffdcf6122125c36


