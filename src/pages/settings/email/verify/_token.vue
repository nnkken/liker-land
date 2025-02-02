<template>
  <div class="flex flex-col justify-center flex-grow">
    <template v-if="isLoading">
      <Label :text="$t('settings_email_verify_verifying')" align="center" />
      <ProgressIndicator class="self-center mt-[16px]" />
    </template>
    <Label v-else-if="isVerifiedEmail" :text="$t('settings_email_verify_verified')" align="center" />
    <Label v-else-if="error" align="center">
      {{ $t('settings_email_verify_error_message', { error }) }}
    </Label>
    <Label v-else align="center">
      {{ $t('settings_email_verify_error_message_unknown') }}
    </Label>
    <div class="flex justify-center gap-[16px] mt-[16px]">
      <ButtonV2
        v-if="!isLoading && !isVerifiedEmail"
        :text="$t('settings_email_verify_retry_button')"
        preset="outline"
        @click="handleClickRetry"
      />
      <ButtonV2
        :text="$t('settings_email_verify_verified_back_button')"
        preset="secondary"
        @click="handleClickBack"
      />
    </div>
  </div>
</template>

<script>
import { mapActions } from 'vuex';

import { logTrackerEvent } from '~/util/EventLogger';

import alertMixin from '~/mixins/alert';
import walletMixin from '~/mixins/wallet';

export default {
  name: 'SettingsEmailVerifyPage',
  mixins: [alertMixin, walletMixin],
  data() {
    return {
      isLoading: true,
      isVerifiedEmail: false,
      error: '',
    };
  },
  computed: {
    token() {
      return this.$route.params.token;
    },
    verificationWallet() {
      return this.$route.query.wallet;
    },
  },
  mounted() {
    this.verify();
  },
  methods: {
    ...mapActions(['walletVerifyEmail']),
    async verify() {
      try {
        this.isLoading = true;
        await this.walletVerifyEmail({
          wallet: this.verificationWallet,
          token: this.token,
        });
        this.isVerifiedEmail = true;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        this.error = error.response?.data || error.message;
        this.alertPromptError(
          this.$t('settings_email_verify_error_message', {
            error: this.error,
          })
        );
      } finally {
        this.isLoading = false;
      }
    },
    handleClickBack() {
      logTrackerEvent(
        this,
        'Settings',
        'settings_email_verify_back_button_clicked',
        '',
        1
      );
      this.$router.push(this.localeLocation({ name: 'settings' }));
    },
    handleClickRetry() {
      logTrackerEvent(
        this,
        'Settings',
        'settings_email_verify_retry_button_clicked',
        '',
        1
      );
      this.verify();
    },
  },
};
</script>
