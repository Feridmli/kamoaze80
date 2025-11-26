import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ===================== CONFIG =====================
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  window?.__BACKEND_URL__ ||
  "https://kamoaze80.onrender.com";

const NFT_CONTRACT_ADDRESS =
  import.meta.env.VITE_NFT_CONTRACT ||
  window?.__NFT_CONTRACT__ ||
  "0x54a88333F6e7540eA982261301309048aC431eD5";

const SEAPORT_CONTRACT_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395";

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ===================== STATE =====================
let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");

// ===================== HELPERS =====================
function notify(msg, timeout = 3000) {
  if (!noticeDiv) return;
  noticeDiv.textContent = msg;
  console.log(`[NOTIFY]: ${msg}`);
  if (timeout)
    setTimeout(() => {
      if (noticeDiv.textContent === msg) noticeDiv.textContent = "";
    }, timeout);
}

function orderToJsonSafe(obj) {
  return JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (v && typeof v === "object") {
        if (ethers.BigNumber.isBigNumber(v)) return v.toString();
        if (v._hex) return ethers.BigNumber.from(v._hex).toString();
      }
      if (typeof v === "bigint") return v.toString();
      return v;
    })
  );
}

function resolveIPFS(url) {
  if (!url) return "https://via.placeholder.com/300?text=No+Image";
  const GATEWAY = "https://cloudflare-ipfs.com/ipfs/";
  if (url.startsWith("ipfs://")) return url.replace("ipfs://", GATEWAY);
  if (url.startsWith("Qm") && url.length >= 46) return `${GATEWAY}${url}`;
  return url;
}

// ===================== WALLET =====================
async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask tapılmadı!");
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    userAddress = (await signer.getAddress())?.toLowerCase();
    if (!userAddress) return alert("Cüzdan adresi tapılmadı!");

    const network = await provider.getNetwork();
    if (network.chainId !== APECHAIN_ID) {
      try {
        await provider.send("wallet_addEthereumChain", [
          {
            chainId: APECHAIN_ID_HEX,
            chainName: "ApeChain Mainnet",
            nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
            rpcUrls: [import.meta.env.VITE_APECHAIN_RPC || "https://rpc.apechain.com"],
            blockExplorerUrls: ["https://apescan.io"],
          },
        ]);
        notify("Şəbəkə dəyişdirildi, yenidən qoşulun.");
        return;
      } catch (e) {
        console.error("Network switch error:", e);
      }
    }

    seaport = new Seaport(signer, { overrides: { contractAddress: SEAPORT_CONTRACT_ADDRESS } });
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    notify("Cüzdan qoşuldu!");
    await loadNFTs();
  } catch (err) {
    console.error(err);
    alert("Wallet connect xətası: " + err.message);
  }
}

disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";
  notify("Cüzdan ayırıldı", 2000);
};

connectBtn.onclick = connectWallet;

// ===================== LOAD NFTs =====================
let loadingNFTs = false;
let loadedCount = 0;
const BATCH_SIZE = 12;
let allNFTs = [];

async function loadNFTs() {
  if (loadingNFTs) return;
  loadingNFTs = true;
  try {
    if (allNFTs.length === 0) {
      const res = await fetch(`${BACKEND_URL}/api/nfts`);
      const data = await res.json();
      allNFTs = data.nfts || [];
    }
    if (loadedCount >= allNFTs.length) {
      if (loadedCount === 0)
        marketplaceDiv.innerHTML =
          "<p style='color:white; text-align:center;'>Bu səhifədə hələ NFT yoxdur.</p>";
      return;
    }

    const batch = allNFTs.slice(loadedCount, loadedCount + BATCH_SIZE);
    loadedCount += batch.length;

    for (const nft of batch) {
      const tokenid = nft.tokenid;
      const name = nft.name || `NFT #${tokenid}`;
      const image = resolveIPFS(nft.image);
      let displayPrice = "-";
      if (nft.price && !isNaN(parseFloat(nft.price))) displayPrice = parseFloat(nft.price) + " APE";

      const card = document.createElement("div");
      card.className = "nft-card";
      card.innerHTML = `
        <img src="${image}" alt="NFT" onerror="this.src='https://via.placeholder.com/300?text=Error'">
        <h4>${name}</h4>
        <p class="price">Qiymət: ${displayPrice}</p>
        <div class="nft-actions">
            <input type="number" min="0" step="0.01" class="price-input" placeholder="APE">
            <button class="wallet-btn buy-btn">Buy</button>
            <button class="wallet-btn list-btn" data-token="${tokenid}">List</button>
        </div>
      `;
      marketplaceDiv.appendChild(card);

      card.querySelector(".buy-btn").onclick = async () => await buyNFT(nft);
      card.querySelector(".list-btn").onclick = async (e) => {
        const rawTokenId = e.currentTarget.getAttribute("data-token");
        const priceInput = card.querySelector(".price-input");
        const priceStr = priceInput.value.trim();
        if (!rawTokenId) return notify("Xəta: Token ID yoxdur");
        if (!priceStr) return notify("Zəhmət olmasa qiymət yazın");

        let priceWei;
        try {
          priceWei = ethers.utils.parseEther(priceStr);
        } catch {
          return notify("Qiymət formatı yanlışdır");
        }

        await listNFT(rawTokenId, priceWei, card);
      };
    }
  } catch (err) {
    console.error("Load NFTs Error:", err);
  } finally {
    loadingNFTs = false;
  }
}

window.addEventListener("scroll", () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 300) loadNFTs();
});

// ===================== BUY NFT =====================
async function buyNFT(nftRecord) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  notify("Alış hazırlanır...");

  let rawOrder = nftRecord.seaport_order ?? nftRecord.seaportOrderJSON;
  if (typeof rawOrder === "string") {
    try { rawOrder = JSON.parse(rawOrder); } 
    catch (e) { console.error("Order parse error", e); return alert("Order parse xətası"); }
  }
  if (rawOrder && rawOrder.order) rawOrder = rawOrder.order;
  if (!rawOrder || !rawOrder.parameters) return alert("Bu NFT-nin satış məlumatları xətalıdır!");

  try {
    const buyer = await signer.getAddress();
    if (!buyer) return alert("Cüzdan adresi tapılmadı!");

    notify("Transaction imzalanır...");
    const fulfill = await seaport.fulfillOrder({ order: rawOrder, accountAddress: buyer });
    if (!fulfill || !fulfill.executeAllActions) throw new Error("Seaport executeAllActions undefined");

    const tx = await fulfill.executeAllActions();
    if (tx.wait) await tx.wait();

    notify("NFT uğurla alındı! 🎉");

    const postPrice = nftRecord.price ? parseFloat(nftRecord.price) : 0;
    await fetch(`${BACKEND_URL}/api/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenid: nftRecord.tokenid,
        nft_contract: NFT_CONTRACT_ADDRESS,
        marketplace_contract: SEAPORT_CONTRACT_ADDRESS,
        buyer_address: buyer,
        order_hash: nftRecord.order_hash,
        price: postPrice,
        on_chain: true,
      }),
    });

    setTimeout(() => { loadedCount = 0; allNFTs = []; marketplaceDiv.innerHTML = ""; loadNFTs(); }, 2000);
  } catch (err) {
    console.error("Buy Error:", err);
    alert("Buy Xətası: " + (err.reason || err.message));
  }
}

// ===================== LIST NFT =====================
async function listNFT(tokenid, priceWei, card) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  if (!tokenid) return alert("Token ID boşdur!");
  if (!NFT_CONTRACT_ADDRESS) return alert("NFT contract address undefined!");
  if (!priceWei) return alert("Qiymət undefined!");

  try {
    const seller = await signer.getAddress();
    if (!seller) return alert("Cüzdan adresi tapılmadı!");

    const tokenStr = tokenid.toString();
    const nftContract = new ethers.Contract(
      NFT_CONTRACT_ADDRESS,
      ["function ownerOf(uint256) view returns (address)", "function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"],
      signer
    );

    const owner = await nftContract.ownerOf(tokenStr);
    if (owner.toLowerCase() !== seller.toLowerCase()) return alert("Bu NFT sizə məxsus deyil!");

    const approved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
    if (!approved) {
      const tx = await nftContract.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
      await tx.wait();
    }

    // ====== ORDER INPUT ======
    const orderInput = {
      offer: [{ itemType: 2, token: NFT_CONTRACT_ADDRESS, identifier: tokenStr }],
      consideration: [{ itemType: 0, token: ZERO_ADDRESS, identifier: "0", amount: priceWei.toString(), recipient: seller }],
      startTime: (Math.floor(Date.now() / 1000) - 60).toString(),
      endTime: (Math.floor(Date.now() / 1000) + 30 * 86400).toString(),
      conduitKey: "0x0000000000000000000000000000000000000000"
    };

    const create = await seaport.createOrder(orderInput, seller);
    if (!create || !create.executeAllActions) throw new Error("Seaport executeAllActions undefined");

    const signedOrder = await create.executeAllActions();
    const orderHash = seaport.getOrderHash(signedOrder.parameters);
    const plainOrder = orderToJsonSafe(signedOrder);

    await fetch(`${BACKEND_URL}/api/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenid: tokenStr,
        price: ethers.utils.formatEther(priceWei),
        nft_contract: NFT_CONTRACT_ADDRESS,
        marketplace_contract: SEAPORT_CONTRACT_ADDRESS,
        seller_address: seller.toLowerCase(),
        seaport_order: plainOrder,
        order_hash: orderHash,
        on_chain: false,
      }),
    });

    card.querySelector(".price").textContent = "Qiymət: " + ethers.utils.formatEther(priceWei) + " APE";
    card.querySelector(".price-input").value = "";

    setTimeout(() => { loadedCount = 0; allNFTs = []; marketplaceDiv.innerHTML = ""; loadNFTs(); }, 1500);

  } catch (err) {
    console.error("List Error:", err);
    alert("Listing Xətası: " + (err.message || "Bilinməyən xəta"));
  }
}

// ===================== EXPORT =====================
window.connectWallet = connectWallet;
window.buyNFT = buyNFT;
window.listNFT = listNFT;
window.loadNFTs = loadNFTs;