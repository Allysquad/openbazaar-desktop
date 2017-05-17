import $ from 'jquery';
import { getSocket } from '../../utils/serverConnect';
import BaseModel from '../BaseModel';
import app from '../../app';
import Image from './Image';
import Moderator from './Moderator';
import Colors from './Colors';
import Contact from './Contact';
import { decimalToInteger, integerToDecimal } from '../../utils/currency';

export default class extends BaseModel {
  defaults() {
    return {
      about: '',
      handle: '',
      location: '',
      moderator: false,
      name: `OB ${(Math.floor(Math.random() * 2116316159) + 60466176).toString(36)}`,
      nsfw: false,
      shortDescription: '',
      avatarHashes: new Image(),
      headerHashes: new Image(),
      vendor: false,
      colors: new Colors(),
      contactInfo: new Contact(),
      stats: new BaseModel(),
    };
  }

  url() {
    return app.getServerUrl(`ob/profile/${this.id}`);
  }

  // todo: set peerId instead of ID when setting ID.
  get idAttribute() {
    return 'peerID';
  }

  get nested() {
    return {
      avatarHashes: Image,
      headerHashes: Image,
      moderatorInfo: Moderator,
      colors: Colors,
      contactInfo: Contact,
      stats: BaseModel,
    };
  }

  get isModerator() {
    return this.get('moderator') &&
      !!this.get('moderatorInfo');
  }

  get max() {
    return {
      locationLength: 100,
    };
  }

  validate(attrs) {
    const errObj = this.mergeInNestedErrors({});
    const addError = (fieldName, error) => {
      errObj[fieldName] = errObj[fieldName] || [];
      errObj[fieldName].push(error);
    };

    if (!attrs.name) {
      addError('name', app.polyglot.t('profileModelErrors.provideName'));
    }

    if (attrs.handle && attrs.handle.charAt(0) === '@') {
      addError('handle', 'The handle should not start with a leading @.');
    }

    if (attrs.location && attrs.location.length > this.max.locationLength) {
      addError('location', app.polyglot.t('profileModelErrors.locationTooLong'));
    }

    if (typeof attrs.vendor !== 'boolean') {
      // this error should never be visible to the user
      addError('vendor', `The vendor value is not a boolean: ${attrs.vendor}`);
    }

    if (Object.keys(errObj).length) return errObj;

    return undefined;
  }

  // Ensure any colors are strings and have a leading hash.
  standardizeColorFields(attrs = {}) {
    const updatedAttrs = { ...attrs };

    Object.keys(attrs).forEach((field) => {
      if (typeof attrs[field] !== 'undefined') {
        updatedAttrs[field] = updatedAttrs[field].toString();
        updatedAttrs[field] = updatedAttrs[field].charAt(0) !== '#' ?
          `#${updatedAttrs[field]}` : updatedAttrs[field];
      }
    });

    return updatedAttrs;
  }

  parse(resp) {
    const response = { ...resp };

    if (response.moderatorInfo && response.moderatorInfo.fee &&
      response.moderatorInfo.fee.fixedFee) {
      const amount = response.moderatorInfo.fee.fixedFee.amount;
      const isBtc = response.moderatorInfo.fee.fixedFee.currencyCode === 'BTC';

      response.moderatorInfo.fee.fixedFee.amount = integerToDecimal(amount, isBtc);
    }

    if (response.handle && response.handle.startsWith('@')) {
      response.handle = response.handle.slice(1);
    }

    if (response.colors) {
      response.colors = this.standardizeColorFields(response.colors);
    }

    return response;
  }

  sync(method, model, options) {
    // the server doesn't want the id field
    options.attrs = options.attrs || model.toJSON(options);
    delete options.attrs.id;

    // ensure certain fields that shouldn't be updated don't go
    // to the server
    if (method !== 'read') {
      delete options.attrs.lastModified;

      if (options.attrs.stats) {
        delete options.attrs.stats.followerCount;
        delete options.attrs.stats.followingCount;
        delete options.attrs.stats.listingCount;
        delete options.attrs.stats.ratingCount;
        delete options.attrs.stats.averageRating;
      }

      if (method !== 'delete') {
        // convert the amount field
        if (options.attrs.moderatorInfo && options.attrs.moderatorInfo.fee &&
          options.attrs.moderatorInfo.fee.fixedFee &&
          options.attrs.moderatorInfo.fee.fixedFee.amount) {
          const amount = options.attrs.moderatorInfo.fee.fixedFee.amount;
          const isBTC = options.attrs.moderatorInfo.fee.fixedFee.currencyCode === 'BTC';
          options.attrs.moderatorInfo.fee.fixedFee.amount = decimalToInteger(amount, isBTC);
        }
      }
    }

    if (method !== 'create' && !this.get('peerID')) {
      throw new Error('I am unable to fetch, save or delete because the model does not' +
        ' have a peerID set.');
    }

    return super.sync(method, model, options);
  }
}

const profileDeferreds = {};

export function getProfiles(peerIds = [], options = {}) {
  if (!Array.isArray(peerIds)) {
    throw new Error('Please provide an array of peer ids.');
  }

  if (!getSocket()) {
    throw new Error('Unable to obtain profiles without a server connection.');
  }

  const opts = {
    async: true,
    usecache: true,
    ...options,
  };
  const promises = [];
  const profilesToFetch = [];

  peerIds.forEach(id => {
    if (!profileDeferreds[id]) {
      const deferred = $.Deferred();
      profileDeferreds[id] = deferred;
      profilesToFetch.push(id);
    }

    promises.push(profileDeferreds[id].promise());
  });

  if (profilesToFetch.length) {
    const queryString = $.param({
      async: opts.async,
      usecache: opts.usecache,
    });
    $.post({
      url: app.getServerUrl(`ob/fetchprofiles?${queryString}`),
      data: JSON.stringify(profilesToFetch),
      dataType: 'json',
      contentType: 'application/json',
    }).done((data) => {
      const socket = getSocket();
      if (socket) {
        const onMessage = (e) => {
          if (e.jsonData.id === data.id) {
            profileDeferreds[e.jsonData.peerId].resolve(e.jsonData.profile);
          }

          socket.off(null, onMessage);
        };

        socket.on('message', onMessage);
      }
    });
  }

  return promises;
}
