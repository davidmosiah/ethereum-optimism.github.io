import {
    AbstractProvider,
    FallbackProvider,
    JsonRpcProvider,
    Networkish
} from 'ethers'
import { Chain } from './types'

interface ProviderConfig {
    timeout?: number
    retries?: number
    throttleLimit?: number
}

const DEFAULT_CONFIG: ProviderConfig = {
    timeout: 30000, // 30 seconds
    retries: 3,
    throttleLimit: 1
}

/**
 * Custom provider that tries multiple RPC endpoints sequentially
 * Returns the first successful response, skipping failed endpoints
 */
/**
 * Creates a robust provider with timeout, retry, and fallback capabilities
 */
export const createRobustProvider = (
    urls: string | string[],
    networkish?: Networkish,
    config: ProviderConfig = {}
): AbstractProvider => {
    const finalConfig = { ...DEFAULT_CONFIG, ...config }
    const urlArray = Array.isArray(urls) ? urls : [urls]

    // Single provider with timeout
    if (urlArray.length === 1) {
        return new JsonRpcProvider(urlArray[0], networkish, {
            staticNetwork: true
        })
    }

    // Multiple providers with sequential fallback
    const providers = urlArray.map(url =>
        new JsonRpcProvider(url, networkish, {
            staticNetwork: true
        })
    )

    return new FallbackProvider(
        providers.map((provider, index) => ({
            provider,
            priority: index + 1,
            stallTimeout: finalConfig.timeout,
            weight: 1
        })),
        networkish,
        { quorum: 1 }
    )
}

/**
 * Get RPC URLs with environment variable overrides and fallbacks
 */
export const getRpcUrls = (chain: Chain): string[] => {
    const envKey = `${chain.toUpperCase().replace('-', '_')}_RPC_URL`
    const envUrl = process.env[envKey]

    if (envUrl) {
        return [envUrl, ...getDefaultRpcUrls(chain)]
    }

    return getDefaultRpcUrls(chain)
}

/**
 * Get Alchemy API key from environment variable
 */
const getAlchemyApiKey = (): string => {
    return process.env.ALCHEMY_API_KEY || ''
}

/**
 * Default RPC URLs with Alchemy endpoints and fallbacks
 */
const getDefaultRpcUrls = (chain: Chain): string[] => {
    const alchemyApiKey = getAlchemyApiKey()

    const rpcMap: Record<Chain, string[]> = {
        ethereum: [
            ...(alchemyApiKey ? [`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`] : []),
            'https://ethereum.publicnode.com'
        ],
        sepolia: [
            ...(alchemyApiKey ? [`https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`] : []),
            'https://rpc.sepolia.org',
            'https://ethereum-sepolia.publicnode.com'
        ],
        optimism: [
            ...(alchemyApiKey ? [`https://opt-mainnet.g.alchemy.com/v2/${alchemyApiKey}`] : []),
            'https://mainnet.optimism.io',
            'https://optimism.publicnode.com'
        ],
        'optimism-sepolia': [
            ...(alchemyApiKey ? [`https://opt-sepolia.g.alchemy.com/v2/${alchemyApiKey}`] : []),
            'https://sepolia.optimism.io'
        ],
        base: [
            ...(alchemyApiKey ? [`https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`] : []),
            'https://mainnet.base.org',
            'https://base.publicnode.com'
        ],
        'base-sepolia': [
            ...(alchemyApiKey ? [`https://base-sepolia.g.alchemy.com/v2/${alchemyApiKey}`] : []),
            'https://sepolia.base.org'
        ],

        // Chains not supported by Alchemy - use native endpoints
        unichain: [
            'https://mainnet.unichain.org'
        ],
        'unichain-sepolia': [
            'https://sepolia.unichain.org'
        ],
        mode: ['https://mainnet.mode.network'],
        lisk: ['https://rpc.api.lisk.com'],
        'lisk-sepolia': ['https://rpc.sepolia-api.lisk.com'],
        redstone: ['https://rpc.redstonechain.com'],
        metall2: ['https://rpc.metall2.com'],
        'metall2-sepolia': ['https://testnet.rpc.metall2.com'],
        soneium: ['https://rpc.soneium.org'],
        'soneium-minato': ['https://rpc.minato.soneium.org'],
        celo: ['https://forno.celo.org'],
        'celo-sepolia': ['https://forno.celo-sepolia.celo-testnet.org'],
        swellchain: ['https://swell-mainnet.alt.technology'],
        ink: ['https://rpc-gel.inkonchain.com'],
        'ink-sepolia': ['https://rpc-gel-sepolia.inkonchain.com'],
        worldchain: ['https://worldchain-mainnet.g.alchemy.com/public'],
        'worldchain-sepolia': ['https://worldchain-sepolia.g.alchemy.com/public'],
    }

    return rpcMap[chain]
}
