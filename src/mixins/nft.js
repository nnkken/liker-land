import Vue from 'vue';
import { mapActions, mapGetters } from 'vuex';
import { APP_LIKE_CO_VIEW, APP_LIKE_CO_URL_BASE } from '~/constant';
import {
  getNFTHistory,
  postNFTPurchase,
  getAddressLikerIdMinApi,
} from '~/util/api';
import { sendGrant } from '~/util/nft';

export default {
  data() {
    return {
      iscnOwnerInfo: {},
      NFTHistory: [],
      displayNameList: {},
      avatarList: {},
      civicLikerList: {},

      isOwnerInfoLoading: false,
      isHistoryInfoLoading: false,
    };
  },
  computed: {
    ...mapGetters([
      'getNFTClassPurchaseInfoById',
      'getNFTClassMetadataById',
      'getNFTClassOwnerInfoById',
      'getNFTClassOwnerCount',
      'getNFTClassMintedCount',
      'getAddress',
    ]),
    isCivicLiker() {
      return !!(
        this.iscnOwnerInfo &&
        (this.iscnOwnerInfo.isCivicLikerTrial ||
          this.iscnOwnerInfo.isSubscribedCivicLiker)
      );
    },
    NFTClassMetadata() {
      return this.getNFTClassMetadataById(this.classId) || {};
    },
    purchaseInfo() {
      return this.getNFTClassPurchaseInfoById(this.classId) || {};
    },
    ownerInfo() {
      return this.getNFTClassOwnerInfoById(this.classId) || {};
    },
    iscnId() {
      return this.NFTClassMetadata.iscn_id;
    },
    iscnOwner() {
      return this.NFTClassMetadata.iscn_owner;
    },
    iscnURL() {
      return `${APP_LIKE_CO_VIEW}/${encodeURIComponent(this.iscnId)}`;
    },
    // nft info
    NFTName() {
      return this.NFTClassMetadata.name;
    },
    NFTDescription() {
      return this.NFTClassMetadata.description;
    },
    NFTImageUrl() {
      return this.NFTClassMetadata.image;
    },
    NFTImageBackgroundColor() {
      return this.NFTClassMetadata.background_color;
    },
    NFTExternalUrl() {
      return this.NFTClassMetadata.external_url;
    },
    NFTPrice() {
      return this.purchaseInfo.price && this.purchaseInfo.price;
    },
    ownerList() {
      return this.getNFTClassOwnerInfoById(this.classId) || {};
    },
    ownerCount() {
      return this.getNFTClassOwnerCount(this.classId);
    },
    sortedOwnerListId() {
      const { ownerList } = this;
      return Object.keys(ownerList).sort(
        (a, b) => ownerList[b].length - ownerList[a].length
      );
    },
    mintedCount() {
      return this.getNFTClassMintedCount(this.classId);
    },
    purchaseURL() {
      return `${APP_LIKE_CO_URL_BASE}/nft/purchase/${encodeURIComponent(
        this.iscnId
      )}%2F1`;
    },
    populatedEvents() {
      return this.NFTHistory.map(event => ({
        ...event,
        toDisplayName: this.displayNameList[event.toWallet] || event.toWallet,
        fromDisplayName:
          this.displayNameList[event.fromWallet] || event.toWafromWalletllet,
      }));
    },
    populatedCollectors() {
      return this.sortedOwnerListId.map(id => ({
        id,
        displayName: this.displayNameList[id] || id,
        collectedCount: this.ownerList[id].length,
      }));
    },
    getTransferNFTId() {
      const OwnNFT = this.ownerList[this.getAddress];
      return OwnNFT[0];
    },
    getOwnedCount() {
      const list = this.getNFTClassOwnerInfoById(this.classId);
      return (
        (list[this.getAddress] && this.ownerList[this.getAddress].length) || 0
      );
    },
  },
  methods: {
    ...mapActions([
      'fetchNFTPurchaseInfo',
      'fetchNFTMetadata',
      'fetchNFTOwners',
    ]),
    updateNFTData() {
      this.updateNFTClassMetdata();
      this.updateNFTPurchaseInfo();
      this.updateNFTOwners();
    },
    async updateNFTClassMetdata() {
      await this.fetchNFTMetadata(this.classId);
      this.updateDisplayNameList(
        this.getNFTClassMetadataById(this.classId)?.iscn_owner
      );
    },
    async updateNFTPurchaseInfo() {
      await this.fetchNFTPurchaseInfo(this.classId);
    },
    async updateNFTOwners() {
      await this.fetchNFTOwners(this.classId);
      this.updateDisplayNameList(
        Object.keys(this.getNFTClassOwnerInfoById(this.classId))
      );
    },
    async updateNFTHistory() {
      this.isHistoryInfoLoading = true;
      const { data } = await this.$api.get(
        getNFTHistory({ classId: this.classId })
      );
      this.NFTHistory = data.list;
      const array = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const list of data.list) {
        array.push(list.fromWallet, list.toWallet);
      }
      this.updateDisplayNameList([...new Set(array)]);
      this.isHistoryInfoLoading = false;
    },
    updateDisplayNameList(addresses) {
      if (typeof addresses === 'string') {
        return this.getAddressLikerId(addresses);
      }
      return Promise.all(addresses.map(this.getAddressLikerId));
    },
    async getAddressLikerId(addr) {
      try {
        const { data } = await this.$api.get(getAddressLikerIdMinApi(addr));
        Vue.set(this.displayNameList, addr, data.displayName);
        Vue.set(
          this.avatarList,
          addr,
          data.avatar ||
            `https://avatars.dicebear.com/api/identicon/${addr}.svg`
        );
        Vue.set(this.civicLikerList, addr, data.isSubscribedCivicLiker);
      } catch (error) {
        Vue.set(this.displayNameList, addr, addr);
        Vue.set(
          this.avatarList,
          addr,
          `https://avatars.dicebear.com/api/identicon/${addr}.svg`
        );
      }
    },
    async collectNFT(address, classId, signer) {
      if (this.classId !== classId) this.classId = classId;
      // TODO: Lock UI and show progress bar
      const txHash = await sendGrant({
        senderAddress: address,
        amountInLIKE: this.purchaseInfo.totalPrice,
        signer,
      });
      const res = await this.$api.post(postNFTPurchase({ txHash, classId }));
      return res;
    },
  },
};
