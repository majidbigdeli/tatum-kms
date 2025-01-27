import { PendingTransaction } from '@tatumio/api-client'
import { TatumCardanoSDK } from '@tatumio/cardano'
import { TatumCeloSDK } from '@tatumio/celo'
import { TatumSolanaSDK } from '@tatumio/solana'
import {
  algorandBroadcast,
  bcashBroadcast,
  bnbBroadcast,
  bscBroadcast,
  btcBroadcast,
  Currency,
  dogeBroadcast,
  egldBroadcast,
  ethBroadcast,
  flowBroadcastTx,
  flowSignKMSTransaction,
  generatePrivateKeyFromMnemonic,
  klaytnBroadcast,
  ltcBroadcast,
  offchainBroadcast,
  oneBroadcast,
  polygonBroadcast,
  signAlgoKMSTransaction,
  signBitcoinCashKMSTransaction,
  signBitcoinCashOffchainKMSTransaction,
  signBitcoinKMSTransaction,
  signBitcoinOffchainKMSTransaction,
  signBnbKMSTransaction,
  signBscKMSTransaction,
  signDogecoinKMSTransaction,
  signDogecoinOffchainKMSTransaction,
  signEgldKMSTransaction,
  signEthKMSTransaction,
  signEthOffchainKMSTransaction,
  signKlayKMSTransaction,
  signLitecoinKMSTransaction,
  signLitecoinOffchainKMSTransaction,
  signOneKMSTransaction,
  signPolygonKMSTransaction,
  signVetKMSTransaction,
  signXdcKMSTransaction,
  TransactionHash,
  TransactionKMS,
  vetBroadcast,
  xdcBroadcast,
} from '@tatumio/tatum'
import { broadcast as kcsBroadcast, generatePrivateKeyFromMnemonic as kcsGeneratePrivateKeyFromMnemonic, signKMSTransaction as signKcsKMSTransaction, } from '@tatumio/tatum-kcs'
import { TatumTronSDK } from '@tatumio/tron'
import { TatumXlmSDK } from '@tatumio/xlm'
import { TatumXrpSDK } from '@tatumio/xrp'
import { AxiosInstance, AxiosError } from 'axios'
import _ from 'lodash'
import { KMS_CONSTANTS } from './constants'
import { Signature, Wallet } from './interfaces'
import { getManagedWallets, getWallet, getWalletWithMnemonicForChain } from './management'
import { TransactionQtyResponseVM, AppTransactionKMS } from './types'

const TATUM_URL: string = process.env.TATUM_API_URL || 'https://api.tatum.io'

const getPrivateKeys = async (wallets: Wallet[], signatures: Signature[], currency: Currency): Promise<string[]> => {
  const keys: string[] = []
  if (!wallets || wallets?.length === 0) {
    return keys
  }
  for (const w of wallets) {
    if (signatures.length > 0) {
      for (const s of signatures) {
        if (!_.isNil(w.mnemonic) && !_.isNil(s.index)) {
          const key = await generatePrivateKeyFromMnemonic(currency, w.testnet, w.mnemonic, s.index)
          if (key) keys.push(key)
        }
      }
    } else {
      keys.push(w.privateKey)
    }
  }

  return keys
}

function validatePrivateKeyWasFound(wallet: any, blockchainSignature: TransactionKMS, privateKey: string | undefined) {
  if (privateKey) return

  const index = blockchainSignature.index
  const signatureIdsLog = getSignatureIdsLog(blockchainSignature)
  if (isValidNumber(index)) {
    if (_.isNil(wallet.mnemonic)) {
      throw new Error(
        `Private key was not found. Wallet ${signatureIdsLog} is private key based, but KMS transaction ${blockchainSignature.id} requires mnemonic based, since tx was requested with index param. Please use mnemonic based wallet and signatureId (see docs: https://apidoc.tatum.io/)`,
      )
    }
  } else {
    if (_.isNil(wallet.privateKey)) {
      throw new Error(
        `Private key was not found. Wallet ${signatureIdsLog} is mnemonic based, but KMS transaction ${blockchainSignature.id} requires private key based, since tx was requested without index param. Please use another private key based wallet id or specify 'index' parameter for this mnemonic based wallet during request call (see docs: https://apidoc.tatum.io/)`,
      )
    }
  }
}

const processTransaction = async (
  appBlockchainSignature: AppTransactionKMS,
  testnet: boolean,
  pwd: string,
  axios: AxiosInstance,
  path?: string,
  externalUrl?: string,
): Promise<TransactionHash | undefined> => {
  let blockchainSignature = CopyToTransactionKMS(appBlockchainSignature);

  if (externalUrl) {
    console.log(`${new Date().toISOString()} - External url '${externalUrl}' is present, checking against it.`)
    try {
      await axios.get(`${externalUrl}/${blockchainSignature.id}`)
    } catch (e) {
      console.error(e)
      console.error(
        `${new Date().toISOString()} - Transaction not found on external system. ID: ${blockchainSignature.id}`,
      )
      return
    }
  }
  const wallets = []
  for (const hash of blockchainSignature.hashes) {
    wallets.push(await getWallet(hash, pwd, path, false))
  }
  const signatures = blockchainSignature.signatures ?? []
  if (signatures.length > 0) {
    wallets.push(...((await getWalletWithMnemonicForChain(blockchainSignature.chain, path, pwd, false)) ?? []))
  }

  let txData = ''
  console.log(
    `${new Date().toISOString()} - Processing pending transaction - ${JSON.stringify(blockchainSignature, null, 2)}.`,
  )

  const apiKey = process.env.TATUM_API_KEY as string

  let th: TransactionHash | undefined = undefined;

  switch (blockchainSignature.chain) {
    case Currency.ALGO: {
      const algoSecret = wallets[0].secret ? wallets[0].secret : wallets[0].privateKey
      th = await algorandBroadcast(
        await signAlgoKMSTransaction(blockchainSignature, algoSecret, testnet),
        blockchainSignature.id,
      )
      return th;
    }
    case Currency.SOL: {
      const solSDK = TatumSolanaSDK({ apiKey: process.env.TATUM_API_KEY as string, url: TATUM_URL as any })
      txData = await solSDK.kms.sign(
        blockchainSignature as PendingTransaction,
        wallets.map(w => w.privateKey),
      )
      const data = await axios.post<TransactionHash>(
        `${TATUM_URL}/v3/solana/broadcast`,
        { txData, signatureId: blockchainSignature.id },
        { headers: { 'x-api-key': apiKey } },
      )
      th = data.data;
      return th;
    }
    case Currency.BCH: {
      if (blockchainSignature.withdrawalId) {
        txData = await signBitcoinCashOffchainKMSTransaction(blockchainSignature, wallets[0].mnemonic, testnet)
      } else {
        th = await bcashBroadcast(
          await signBitcoinCashKMSTransaction(
            blockchainSignature,
            wallets.map(w => w.privateKey),
            testnet,
          ),
          blockchainSignature.id,
        )
        return th;
      }
      break
    }
    case Currency.BNB: {
      th = await bnbBroadcast(
        await signBnbKMSTransaction(blockchainSignature, wallets[0].privateKey, testnet),
        blockchainSignature.id,
      )
      return th;
    }
    case Currency.VET: {
      const wallet = wallets[0]
      const pk =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.BNB,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, pk)
      th = await vetBroadcast(await signVetKMSTransaction(blockchainSignature, pk, testnet), blockchainSignature.id)
      return th;
    }
    case Currency.XRP: {
      const xrpSdk = TatumXrpSDK({ apiKey: process.env.TATUM_API_KEY as string, url: TATUM_URL as any })
      txData = await xrpSdk.kms.sign(blockchainSignature as PendingTransaction, wallets[0].secret)
      th = await xrpSdk.blockchain.broadcast({ txData, signatureId: blockchainSignature.id })
      return th;
    }
    case Currency.XLM: {
      const xlmSdk = TatumXlmSDK({ apiKey: process.env.TATUM_API_KEY as string, url: TATUM_URL as any })
      txData = await xlmSdk.kms.sign(blockchainSignature as PendingTransaction, wallets[0].secret, testnet)
      th = await xlmSdk.blockchain.broadcast({ txData, signatureId: blockchainSignature.id })
      return th;
    }
    case Currency.ETH: {
      const wallet = wallets[0]
      const privateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.ETH,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, privateKey)
      if (blockchainSignature.withdrawalId) {
        txData = await signEthOffchainKMSTransaction(blockchainSignature, privateKey, testnet)
      } else {
        th = await ethBroadcast(await signEthKMSTransaction(blockchainSignature, privateKey), blockchainSignature.id)
        return th;
      }
      break
    }
    case Currency.FLOW: {
      const wallet = wallets[0]
      const secret =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.FLOW,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, secret)
      const u = blockchainSignature.serializedTransaction
      const r = JSON.parse(u)
      r.body.privateKey = secret
      blockchainSignature.serializedTransaction = JSON.stringify(r)
      const data = await flowBroadcastTx(
        (await flowSignKMSTransaction(blockchainSignature, [secret], testnet))?.txId,
        blockchainSignature.id,
      )
      th = data as TransactionHash;
      return th;
    }
    case Currency.ONE: {
      const wallet = wallets[0]
      const onePrivateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.ONE,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, onePrivateKey)
      txData = await signOneKMSTransaction(blockchainSignature, onePrivateKey, testnet)
      if (!blockchainSignature.withdrawalId) {
        th = await oneBroadcast(txData, blockchainSignature.id)
        return th;
      }
      break
    }
    case Currency.CELO: {
      const wallet = wallets[0]
      const celoPrivateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.CELO,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, celoPrivateKey)
      const celoSDK = TatumCeloSDK({ apiKey: process.env.TATUM_API_KEY as string, url: TATUM_URL as any })
      txData = await celoSDK.kms.sign(blockchainSignature as PendingTransaction, celoPrivateKey)
      th = await celoSDK.blockchain.broadcast({ txData, signatureId: blockchainSignature.id })
      return th;
    }
    case Currency.BSC: {
      const wallet = wallets[0]
      const bscPrivateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.BSC,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, bscPrivateKey)
      th = await bscBroadcast(await signBscKMSTransaction(blockchainSignature, bscPrivateKey), blockchainSignature.id)
      return th
    }
    case Currency.MATIC: {
      const wallet = wallets[0]
      const polygonPrivateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.MATIC,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, polygonPrivateKey)
      th = await polygonBroadcast(
        await signPolygonKMSTransaction(blockchainSignature, polygonPrivateKey, testnet),
        blockchainSignature.id,
      )
      return th;
    }
    case Currency.KLAY: {
      const wallet = wallets[0]
      const klaytnPrivateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.KLAY,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, klaytnPrivateKey)
      th = await klaytnBroadcast(
        await signKlayKMSTransaction(blockchainSignature, klaytnPrivateKey, testnet),
        blockchainSignature.id,
      )
      return th;
    }
    case Currency.KCS: {
      const wallet = wallets[0]
      const kcsPrivateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await kcsGeneratePrivateKeyFromMnemonic(wallet.testnet, wallet.mnemonic, blockchainSignature.index)
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, kcsPrivateKey)
      th = await kcsBroadcast(await signKcsKMSTransaction(blockchainSignature, kcsPrivateKey), blockchainSignature.id)
      return th;
    }
    case Currency.XDC: {
      const wallet = wallets[0]
      const xdcPrivateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.XDC,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, xdcPrivateKey)
      th = await xdcBroadcast(await signXdcKMSTransaction(blockchainSignature, xdcPrivateKey), blockchainSignature.id)
      return th;
    }
    case Currency.EGLD: {
      const wallet = wallets[0]
      const egldPrivateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.EGLD,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, egldPrivateKey)
      th = await egldBroadcast(await signEgldKMSTransaction(blockchainSignature, egldPrivateKey), blockchainSignature.id)
      return th;
    }
    case Currency.TRON: {
      const wallet = wallets[0]
      const tronPrivateKey =
        wallet.mnemonic && !_.isNil(blockchainSignature.index)
          ? await generatePrivateKeyFromMnemonic(
            Currency.TRON,
            wallet.testnet,
            wallet.mnemonic,
            blockchainSignature.index,
          )
          : wallet.privateKey
      validatePrivateKeyWasFound(wallet, blockchainSignature, tronPrivateKey)
      const tronSDK = TatumTronSDK({ apiKey: process.env.TATUM_API_KEY as string, url: TATUM_URL as any })
      txData = await tronSDK.kms.sign(blockchainSignature as PendingTransaction, tronPrivateKey)

      const data = await axios.post<TransactionHash>(
        `${TATUM_URL}/v3/tron/broadcast`,
        { txData, signatureId: blockchainSignature.id },
        { headers: { 'x-api-key': apiKey } },
      )
      th = data.data;
      return th;
    }
    case Currency.BTC: {
      const privateKeys = await getPrivateKeys(wallets, signatures, Currency.BTC)
      if (blockchainSignature.withdrawalId) {
        txData = await signBitcoinOffchainKMSTransaction(blockchainSignature, wallets[0].mnemonic, testnet)
      } else {
        th = await btcBroadcast(await signBitcoinKMSTransaction(blockchainSignature, privateKeys), blockchainSignature.id)
        return th;
      }

      break
    }
    case Currency.LTC: {
      const privateKeys = await getPrivateKeys(wallets, signatures, Currency.LTC)
      if (blockchainSignature.withdrawalId) {
        txData = await signLitecoinOffchainKMSTransaction(blockchainSignature, wallets[0].mnemonic, testnet)
      } else {
        th = await ltcBroadcast(
          await signLitecoinKMSTransaction(blockchainSignature, privateKeys, testnet),
          blockchainSignature.id,
        )
        return th;
      }
      break
    }
    case Currency.DOGE: {
      if (blockchainSignature.withdrawalId) {
        txData = await signDogecoinOffchainKMSTransaction(blockchainSignature, wallets[0].mnemonic, testnet)
      } else {
        th = await dogeBroadcast(
          await signDogecoinKMSTransaction(
            blockchainSignature,
            wallets.map(w => w.privateKey),
            testnet,
          ),
          blockchainSignature.id,
        )
        return th
      }
      break
    }
    case Currency.ADA: {
      const cardanoSDK = TatumCardanoSDK({ apiKey: process.env.TATUM_API_KEY as string, url: TATUM_URL as any })
      if (blockchainSignature.withdrawalId) {
        const privateKeys = []
        const w: { [walletId: string]: { mnemonic: string } } = {}
        for (const signature of (blockchainSignature.signatures || [])) {
          if (signature.id in w) {
            privateKeys.push(await cardanoSDK.wallet.generatePrivateKeyFromMnemonic(w[signature.id].mnemonic, signature.index))
          } else {
            w[signature.id] = await getWallet(signature.id, pwd, path, false)
            privateKeys.push(await cardanoSDK.wallet.generatePrivateKeyFromMnemonic(w[signature.id].mnemonic, signature.index))
          }
        }
        txData = await cardanoSDK.kms.sign(blockchainSignature as PendingTransaction, privateKeys, { testnet })
      } else {
        th = await cardanoSDK.blockchain.broadcast({
          txData: await cardanoSDK.kms.sign(blockchainSignature as PendingTransaction, wallets.map(w => w.privateKey), { testnet }),
          signatureId: blockchainSignature.id,
        })
        return th;
      }
    }
  }
  const data = await offchainBroadcast({
    currency: blockchainSignature.chain,
    signatureId: blockchainSignature.id,
    withdrawalId: blockchainSignature.withdrawalId,
    txData,
  })

  if (data.completed) {
    th = {
      txId: data.txId,
    }
  }
  return th;
}

const getPendingTransactions = async (
  axios: AxiosInstance,
  chain: Currency,
  signatureIds: string[],
  isCustom: boolean,
  externalUrl?: string
): Promise<AppTransactionKMS[]> => {
  if (signatureIds.length > KMS_CONSTANTS.SIGNATURE_IDS) {
    console.error(
      `${new Date().toISOString()} - Error: Exceeded limit ${KMS_CONSTANTS.SIGNATURE_IDS} wallets for chain ${chain}.`,
    )
    return []
  }

  console.log(
    `${new Date().toISOString()} - Getting pending transaction from ${chain} for ${signatureIds.length > KMS_CONSTANTS.OUTPUT_WALLETS ? signatureIds.length + ' ' : ''
    }wallets${signatureIds.length > KMS_CONSTANTS.OUTPUT_WALLETS ? '' : ' ' + signatureIds.join(',')}.`,
  )
  try {



    const url = isCustom === true ? `${externalUrl}/pending/${chain}` : `${TATUM_URL}/v3/kms/pending/${chain}`
    const { data } = await axios.post<AppTransactionKMS[]>(
      url,
      { signatureIds },
      { headers: { 'x-api-key': process.env.TATUM_API_KEY as string } },
    )
    return data
  } catch (e) {
    console.error(
      `${new Date().toISOString()} - Error received from API /v3/kms/pending/${chain} - ${(e as any).config.data}: ` +
      e,
    )
  }
  return []
}

export const processSignatures = async (
  pwd: string,
  testnet: boolean,
  axios: AxiosInstance,
  path?: string,
  chains?: Currency[],
  externalUrl?: string,
  period = 5,
) => {
  let running = false
  const supportedChains = chains || [
    Currency.BCH,
    Currency.VET,
    Currency.XRP,
    Currency.XLM,
    Currency.ETH,
    Currency.BTC,
    Currency.MATIC,
    Currency.KLAY,
    Currency.LTC,
    Currency.DOGE,
    Currency.CELO,
    Currency.BSC,
    Currency.SOL,
    Currency.TRON,
    Currency.BNB,
    Currency.FLOW,
    Currency.XDC,
    Currency.EGLD,
    Currency.ONE,
    Currency.ADA,
    Currency.ALGO,
    Currency.KCS,
  ]
  setInterval(async () => {
    if (running) {
      return
    }
    running = true

    const transactions = []
    try {
      for (const supportedChain of supportedChains) {
        var result = await checkExternalForPenddingTransaction(axios, supportedChain, externalUrl)

        if (result.customKms === 0 && result.originalKms === 0) {
          console.log(`${new Date().toISOString()} - no pending transaction for ${supportedChain}`);
        } else {
          if (result.originalKms > 0) {
            const wallets = getManagedWallets(pwd, supportedChain, testnet, path)
            transactions.push(...(await getPendingTransactions(axios, supportedChain, wallets, false, externalUrl)))
          }

          if (result.customKms > 0) {
            const wallets = getManagedWallets(pwd, supportedChain, testnet, path)
            transactions.push(...(await getPendingTransactions(axios, supportedChain, wallets, true, externalUrl)))
          }
        }

      }
    } catch (e) {
      console.error(e)
    }
    const data = []
    for (const transaction of transactions) {
      try {
        var th = await processTransaction(transaction, testnet, pwd, axios, path, externalUrl)
        if (transaction.isCustom) {
          if (th) {
            await callCompleteTransaction(axios, transaction, th, externalUrl);
          }
        }

        console.log(`${new Date().toISOString()} - Tx was processed: ${transaction.id}`)
      } catch (e) {
        const msg = (<any>e).response ? JSON.stringify((<any>e).response.data, null, 2) : `${e}`
        data.push({ signatureId: transaction.id, error: msg })
        console.error(`${new Date().toISOString()} - Could not process transaction id ${transaction.id}, error: ${msg}`)
      }
    }
    if (data.length > 0) {
      try {
        const url = `${TATUM_URL}/v3/tatum/kms/batch`
        await axios.post(url, { errors: data }, { headers: { 'x-api-key': process.env.TATUM_API_KEY as string } })
        console.log(`${new Date().toISOString()} - Send batch call to url '${url}'.`)
      } catch (e) {
        console.error(
          `${new Date().toISOString()} - Error received from API /v3/tatum/kms/batch - ${(<any>e).config.data}`,
        )
      }
    }
    running = false
  }, period * 1000)
}

function isValidNumber(value: number | undefined): boolean {
  return !_.isNil(value) && _.isNumber(value) && _.isFinite(value)
}

function getSignatureIdsLog(blockchainSignature: TransactionKMS): string {
  const signatures = [...blockchainSignature.hashes, ...(blockchainSignature.signatures?.map(value => value.id) ?? [])]
  return signatures ? signatures.join(',') : ''
}

export const checkExternalForPenddingTransaction = async (axios: AxiosInstance, chain: string, externalUrl?: string): Promise<TransactionQtyResponseVM> => {
  const url = `${externalUrl}/chain/${chain}`;
  try {
    const { data } = await axios.get<TransactionQtyResponseVM>(url);
    return data;
  } catch (error) {
    const err = error as AxiosError
    console.log(err.response?.data);
    //@ts-ignore
    var a: TransactionQtyResponseVM = {};
    a.customKms = 0;
    a.originalKms = 0;
    return a;
  }
};

export const callCompleteTransaction = async (axios: AxiosInstance, transaction: AppTransactionKMS, th: TransactionHash | undefined, externalUrl?: string) => {
  console.log(th);
  if (th) {
    const url = `${externalUrl}/${transaction.id}/${th.txId}`;
    try {
      await axios.put(url);
    }
    catch (error) {
      const err = error as AxiosError
      console.log(err.response?.data);
    }
  }
};

export const CopyToTransactionKMS = (transaction: AppTransactionKMS) => {

  let a =
    {
      chain: transaction.chain,
      hashes: transaction.hashes,
      id: transaction.id,
      index: transaction.index,
      serializedTransaction: transaction.serializedTransaction,
      txId: transaction.txId,
      withdrawalId: transaction.withdrawalId,
      withdrawalResponses: transaction.withdrawalResponses,
    } as TransactionKMS;

  return a;
}


