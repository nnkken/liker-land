/* eslint no-param-reassign: "off" */
import stringify from 'fast-json-stable-stringify';
import {
  LOGIN_MESSAGE,
  LIKECOIN_CHAIN_ID,
  LIKECOIN_CHAIN_MIN_DENOM,
  LIKECOIN_NFT_API_WALLET,
} from '@/constant/index';
import { LIKECOIN_WALLET_CONNECTOR_CONFIG } from '@/constant/network';
import { catchAxiosError } from '~/util/misc';
import { getAccountBalance, getNFTHistoryDataMap } from '~/util/nft';
import {
  getUserInfoMinByAddress,
  getUserV2Self,
  postUserV2Login,
  postUserV2Logout,
  getUserV2Followees,
  postUserV2Followees,
  deleteUserV2Followees,
  postUserV2WalletEmail,
  putUserV2WalletEmail,
  getNFTEvents,
} from '~/util/api';
import { setLoggerUser } from '~/util/EventLogger';

import {
  WALLET_SET_IS_DEBUG,
  WALLET_SET_ADDRESS,
  WALLET_SET_SIGNER,
  WALLET_SET_CONNECTOR,
  WALLET_SET_LIKERINFO,
  WALLET_SET_METHOD_TYPE,
  WALLET_SET_EVENTS,
  WALLET_SET_EVENT_LAST_SEEN_TS,
  WALLET_SET_LIKE_BALANCE,
  WALLET_SET_LIKE_BALANCE_FETCH_PROMISE,
  WALLET_SET_FOLLOWEES,
  WALLET_SET_FOLLOWEES_FETCHING_STATE,
  WALLET_SET_USER_INFO,
  WALLET_SET_IS_LOGGING_IN,
  WALLET_SET_EVENT_FETCHING,
} from '../mutation-types';

const WALLET_EVENT_LIMIT = 100;

let likecoinWalletLib = null;

const state = () => ({
  isDebug: false,
  address: '',
  signer: null,
  connector: null,
  likerInfo: null,
  followees: [],
  isFetchingFollowees: false,
  eventLastSeenTs: 0,
  events: [],
  isInited: null,
  methodType: null,
  likeBalance: null,
  likeBalanceFetchPromise: null,
  isFetchingEvent: false,

  // Note: Suggest to rename to sessionAddress
  loginAddress: '',
  email: '',
  emailUnverified: '',
  isLoggingIn: false,
});

const mutations = {
  [WALLET_SET_IS_DEBUG](state, isDebug) {
    state.isDebug = isDebug;
  },
  [WALLET_SET_ADDRESS](state, address) {
    state.address = address;
  },
  [WALLET_SET_SIGNER](state, signer) {
    state.signer = signer;
  },
  [WALLET_SET_IS_LOGGING_IN](state, isLoggingIn) {
    state.isLoggingIn = isLoggingIn;
  },
  [WALLET_SET_USER_INFO](state, userInfo) {
    if (userInfo) {
      const { user, email, emailUnconfirmed, eventLastSeenTs } = userInfo;
      if (user !== undefined) {
        state.loginAddress = user;
      }
      if (email !== undefined) {
        state.email = email;
      }
      if (emailUnconfirmed !== undefined) {
        state.emailUnverified = emailUnconfirmed;
      }
      if (eventLastSeenTs) {
        state.eventLastSeenTs = eventLastSeenTs;
      }
    } else {
      state.loginAddress = '';
      state.email = '';
      state.emailUnverified = '';
      state.eventLastSeenTs = -1;
    }
  },
  [WALLET_SET_METHOD_TYPE](state, method) {
    state.methodType = method;
  },
  [WALLET_SET_CONNECTOR](state, connector) {
    state.connector = connector;
  },
  [WALLET_SET_LIKERINFO](state, likerInfo) {
    state.likerInfo = likerInfo;
  },
  [WALLET_SET_EVENTS](state, events) {
    state.events = events;
  },
  [WALLET_SET_EVENT_LAST_SEEN_TS](state, eventLastSeenTs) {
    state.eventLastSeenTs = eventLastSeenTs;
  },
  [WALLET_SET_LIKE_BALANCE](state, likeBalance) {
    state.likeBalance = likeBalance;
  },
  [WALLET_SET_LIKE_BALANCE_FETCH_PROMISE](state, promise) {
    state.likeBalanceFetchPromise = promise;
  },
  [WALLET_SET_FOLLOWEES](state, followees) {
    state.followees = followees;
  },
  [WALLET_SET_FOLLOWEES_FETCHING_STATE](state, isFetching) {
    state.isFetchingFollowees = isFetching;
  },
  [WALLET_SET_EVENT_FETCHING](state, isFetching) {
    state.isFetchingEvent = isFetching;
  },
};

const getters = {
  getAddress: state => state.address,
  getSigner: state => state.signer,
  loginAddress: state => state.loginAddress,
  walletHasLoggedIn: state => !!state.loginAddress,
  walletIsMatchedSession: (state, getters) =>
    getters.walletHasLoggedIn && state.address === state.loginAddress,
  getConnector: state => state.connector,
  getLikerInfo: state => state.likerInfo,
  walletFollowees: state => state.followees,
  walletIsFetchingFollowees: state => state.isFetchingFollowees,
  getIsFetchingEvent: state => state.isFetchingEvent,
  getEvents: state => state.events.slice(0, WALLET_EVENT_LIMIT),
  getLatestEventTimestamp: state =>
    state.events[0]?.timestamp &&
    new Date(state.events[0]?.timestamp).getTime(),
  getEventLastSeenTs: state => state.eventLastSeenTs,
  getHasUnseenEvents: state =>
    state.eventLastSeenTs &&
    state.events[0]?.timestamp &&
    state.eventLastSeenTs < new Date(state.events[0]?.timestamp).getTime(),
  getNotificationCount: (state, getters) => {
    if (!state.eventLastSeenTs || !getters.getEvents || !getters.loginAddress) {
      return 0;
    }
    return getters.getEvents.filter(
      e =>
        state.eventLastSeenTs < new Date(e.timestamp).getTime() &&
        (e.eventType === 'nft_sale' || e.eventType === 'receive_nft')
    ).length;
  },
  walletMethodType: state => state.methodType,
  walletEmail: state => state.email,
  walletEmailUnverified: state => state.emailUnverified,
  walletHasVerifiedEmail: state => !!state.email,
  walletIsLoggingIn: state => state.isLoggingIn,
  walletLIKEBalance: state => state.likeBalance,
  walletLIKEBalanceFetchPromise: state => state.likeBalanceFetchPromise,
};

function formatEventType(e, loginAddress) {
  let eventType;
  if (e.action === 'new_class') {
    eventType = 'mint_nft';
  } else if (e.sender === LIKECOIN_NFT_API_WALLET) {
    if (e.receiver === loginAddress) {
      eventType = 'purchase_nft';
    } else {
      eventType = 'nft_sale';
    }
  } else if (e.receiver === loginAddress) {
    eventType = 'receive_nft';
  } else if (e.sender === loginAddress) {
    eventType = 'send_nft';
  } else {
    eventType = 'transfer_nft';
  }
  return eventType;
}

const actions = {
  async getLikeCoinWalletLib() {
    if (!likecoinWalletLib) {
      likecoinWalletLib = await import(/* webpackChunkName: "likecoin_wallet" */ '@likecoin/wallet-connector');
    }
    return likecoinWalletLib;
  },

  async initWallet(
    { commit, dispatch, getters, state },
    { method, accounts, offlineSigner }
  ) {
    if (!accounts[0]) return false;
    const connector = await dispatch('getConnector');
    // Listen once per account
    connector.once('account_change', async currentMethod => {
      const connection = await connector.init(currentMethod);
      dispatch('walletLogout');
      await dispatch('initWallet', connection);
    });
    commit(WALLET_SET_METHOD_TYPE, method);
    commit(WALLET_SET_LIKERINFO, null);
    const { address, bech32Address } = accounts[0];
    const walletAddress = bech32Address || address;
    commit(WALLET_SET_ADDRESS, walletAddress);
    commit(WALLET_SET_SIGNER, offlineSigner);
    await setLoggerUser(this, { wallet: walletAddress, method });
    catchAxiosError(
      this.$api.$get(getUserInfoMinByAddress(walletAddress)).then(userInfo => {
        commit(WALLET_SET_LIKERINFO, userInfo);
      })
    );
    try {
      if (state.signer && !getters.walletIsMatchedSession) {
        await dispatch('signLogin');
      }
    } catch (err) {
      const msg = (err.response && err.response.data) || err;
      // eslint-disable-next-line no-console
      console.error(msg);
    }
    dispatch('fetchWalletEvents');
    return true;
  },

  async getConnector({ state, commit, dispatch }) {
    if (state.connector) {
      return state.connector;
    }
    const lib = await dispatch('getLikeCoinWalletLib');
    const connector = new lib.LikeCoinWalletConnector({
      ...LIKECOIN_WALLET_CONNECTOR_CONFIG,
    });
    commit(WALLET_SET_CONNECTOR, connector);
    return connector;
  },

  async openConnectWalletModal({ dispatch }, { language } = {}) {
    const connector = await dispatch('getConnector');
    const connection = await connector.openConnectionMethodSelectionDialog({
      language,
    });
    return connection;
  },

  async disconnectWallet({ state, commit, dispatch }) {
    if (state.connector) {
      state.connector.disconnect();
    }
    commit(WALLET_SET_ADDRESS, '');
    commit(WALLET_SET_SIGNER, null);
    commit(WALLET_SET_CONNECTOR, null);
    commit(WALLET_SET_LIKERINFO, null);
    await dispatch('walletLogout');
  },

  async restoreSession({ dispatch }) {
    const connector = await dispatch('getConnector');
    const session = connector.restoreSession();
    if (session) {
      const { accounts, method } = session;
      await dispatch('initWallet', { accounts, method });
    }
  },

  async initIfNecessary({ dispatch }) {
    const connector = await dispatch('getConnector');
    const connection = await connector.initIfNecessary();
    if (connection) {
      const { accounts, offlineSigner, method } = connection;
      await dispatch('initWallet', { accounts, offlineSigner, method });
    }
  },

  async fetchWalletEvents({ state, commit, dispatch }) {
    const { address, followees } = state;
    if (!address) {
      return;
    }
    commit(WALLET_SET_EVENT_FETCHING, true);
    const [involverRes, mintRes] = await Promise.all([
      this.$api.$get(
        getNFTEvents({
          involver: address,
          limit: WALLET_EVENT_LIMIT,
          actionType: '/cosmos.nft.v1beta1.MsgSend',
          ignoreToList: LIKECOIN_NFT_API_WALLET,
          reverse: true,
        })
      ),
      Array.isArray(followees) && followees.length
        ? this.$api.$get(
            getNFTEvents({
              sender: followees,
              actionType: 'new_class',
              limit: WALLET_EVENT_LIMIT,
              reverse: true,
            })
          )
        : Promise.resolve({ events: [] }),
    ]);
    let events = involverRes.events.concat(mintRes.events);
    events = [
      ...new Map(
        events.map(e => [
          [e.tx_hash, e.class_id, e.nft_id, e.eventType].join('-'),
          e,
        ])
      ).values(),
    ];
    const classIds = Array.from(new Set(events.map(e => e.class_id)));

    const addresses = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const list of events) {
      addresses.push(list.sender, list.receiver);
    }
    [...new Set(addresses)]
      .filter(a => !!a)
      .map(a => dispatch('lazyGetUserInfoByAddress', a));

    const promises = events.map(e => {
      if (
        e.action === '/cosmos.nft.v1beta1.MsgSend' &&
        e.sender === LIKECOIN_NFT_API_WALLET
      ) {
        return getNFTHistoryDataMap({
          axios: this.$api,
          classId: e.class_id,
          txHash: e.tx_hash,
        });
      }
      return new Map();
    });

    const historyDatas = await Promise.all(promises);
    historyDatas.forEach((m, index) => {
      if (m) {
        // m is a Map
        m.forEach(data => {
          const { granterMemo, price } = data;
          events[index].price = price;
          events[index].granterMemo = granterMemo;
        });
      }
    });

    commit(
      WALLET_SET_EVENTS,
      events
        .map(e => {
          e.timestamp = new Date(e.timestamp);
          e.eventType = formatEventType(e, address);
          return e;
        })
        .sort((a, b) => b.timestamp - a.timestamp)
    );
    classIds.map(id => dispatch('lazyGetNFTClassMetadata', id));
    commit(WALLET_SET_EVENT_FETCHING, false);
  },

  updateEventLastSeenTs({ commit }, timestamp) {
    commit(WALLET_SET_EVENT_LAST_SEEN_TS, timestamp);
  },

  async walletFetchLIKEBalance({ commit, state }) {
    const { address } = state;
    try {
      let balanceFetch;
      if (state.likeBalanceFetchPromise) {
        balanceFetch = state.likeBalanceFetchPromise;
      } else {
        balanceFetch = getAccountBalance(address);
        commit(WALLET_SET_LIKE_BALANCE_FETCH_PROMISE, balanceFetch);
      }
      const balance = await balanceFetch;
      commit(WALLET_SET_LIKE_BALANCE, balance);
      return balance;
    } catch (error) {
      throw error;
    } finally {
      commit(WALLET_SET_LIKE_BALANCE_FETCH_PROMISE, undefined);
    }
  },
  async walletFetchSessionUserInfo({ commit }, address) {
    try {
      const userInfo = await this.$api.$get(getUserV2Self());
      commit(WALLET_SET_USER_INFO, userInfo || { user: address });
      return userInfo;
    } catch (error) {
      throw error;
    }
  },
  async signLogin({ state, commit, dispatch }) {
    // Do not trigger login if the window is not focused
    if (document.hidden) return;
    if (!state.signer) {
      await dispatch('initIfNecessary');
    }
    const { address } = state;
    const memo = [
      `${LOGIN_MESSAGE}:`,
      JSON.stringify({
        ts: Date.now(),
        address,
      }),
    ].join(' ');
    const payload = {
      chain_id: LIKECOIN_CHAIN_ID,
      memo,
      msgs: [],
      fee: {
        gas: '0',
        amount: [{ denom: LIKECOIN_CHAIN_MIN_DENOM, amount: '0' }],
      },
      sequence: '0',
      account_number: '0',
    };
    try {
      commit(WALLET_SET_IS_LOGGING_IN, true);
      const {
        signed: message,
        signature: { signature, pub_key: publicKey },
      } = await state.signer.sign(address, payload);
      const data = {
        signature,
        publicKey: publicKey.value,
        message: stringify(message),
        from: address,
      };
      await this.$api.post(postUserV2Login(), data);
      await Promise.all([
        dispatch('walletFetchSessionUserInfo', address),
        dispatch('walletFetchFollowees'),
      ]);
    } catch (error) {
      commit(WALLET_SET_USER_INFO, null);
      if (error.message === 'Request rejected') {
        // User rejected login request
      } else {
        // eslint-disable-next-line no-console
        console.error(error);
        throw error;
      }
    } finally {
      commit(WALLET_SET_IS_LOGGING_IN, false);
    }
  },

  async walletLogout({ commit }) {
    try {
      commit(WALLET_SET_USER_INFO, null);
      commit(WALLET_SET_FOLLOWEES, []);
      commit(WALLET_SET_EVENTS, []);
      commit(WALLET_SET_EVENT_LAST_SEEN_TS, 0);
      await this.$api.post(postUserV2Logout());
    } catch (error) {
      throw error;
    }
  },
  async walletUpdateEmail({ state, commit }, email) {
    try {
      await this.$api.$post(postUserV2WalletEmail(email));
      commit(WALLET_SET_USER_INFO, { emailUnconfirmed: email });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      throw error;
    }
  },
  async walletVerifyEmail({ state, commit, getters }, { wallet, token }) {
    try {
      await this.$api.$put(putUserV2WalletEmail(wallet, token));
      if (getters.walletIsMatchedSession) {
        commit(WALLET_SET_USER_INFO, {
          email: state.emailUnverified,
          emailUnconfirmed: '',
        });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      throw error;
    }
  },
  async walletFetchFollowees({ state, commit, dispatch }) {
    try {
      if (state.isFetchingFollowees) return;
      commit(WALLET_SET_FOLLOWEES_FETCHING_STATE, true);
      const { followees } = await this.$axios.$get(getUserV2Followees());
      commit(WALLET_SET_FOLLOWEES, followees);
      if (followees.length) {
        dispatch('lazyGetUserInfoByAddresses', followees);
      }
    } catch (error) {
      throw error;
    } finally {
      commit(WALLET_SET_FOLLOWEES_FETCHING_STATE, false);
    }
  },
  async walletFollowCreator({ state, commit }, creator) {
    const prevFollowees = state.followees;
    try {
      commit(WALLET_SET_FOLLOWEES, [...state.followees, creator].sort());
      await this.$api.$post(postUserV2Followees(creator));
    } catch (error) {
      commit(WALLET_SET_FOLLOWEES, prevFollowees);
      throw error;
    }
  },
  async walletUnfollowCreator({ state, commit }, creator) {
    const prevFollowees = state.followees;
    try {
      await this.$api.$delete(deleteUserV2Followees(creator));
      commit(
        WALLET_SET_FOLLOWEES,
        [...state.followees].filter(followee => followee !== creator)
      );
    } catch (error) {
      commit(WALLET_SET_FOLLOWEES, prevFollowees);
      throw error;
    }
  },
};

export default {
  actions,
  getters,
  state,
  mutations,
};
