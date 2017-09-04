import MailchimpIntegration from 'ghost-admin/models/mailchimp-integration';
import Service from '@ember/service';
import hbs from 'htmlbars-inline-precompile';
import mockMailchimp from '../../../mirage/config/mailchimp';
import mockSettings from '../../../mirage/config/settings';
import moment from 'moment';
import wait from 'ember-test-helpers/wait';
import {click, fillIn, find, keyEvent, triggerEvent} from 'ember-native-dom-helpers';
import {describe, it} from 'mocha';
import {errorOverride, errorReset} from '../../helpers/adapter-error';
import {expect} from 'chai';
import {getOwner} from '@ember/application';
import {setupComponentTest} from 'ember-mocha';
import {startMirage} from 'ghost-admin/initializers/ember-cli-mirage';
import {timeout} from 'ember-concurrency';

const featureStub = Service.extend({
    subscribers: true
});

let mockSettingsPoll = function (server) {
    // enabling or updating and hitting save updates the settings value and polls for updates
    // request 1 = refresh after settings save
    // request 2 = first poll request
    let requestCount = 0;
    server.get('/settings/', function ({db}) {
        requestCount++;

        // update nextSyncAt on second request to simulate background sync
        if (requestCount === 2) {
            let lastSyncAt = moment().valueOf();
            let nextSyncAt = moment().add(24, 'hours').valueOf();
            db.settings.update({key: 'scheduling'}, {value: `{"readonly":true,"subscribers":{"lastSyncAt":${lastSyncAt},"nextSyncAt":${nextSyncAt}}}`});
        }

        return {
            settings: db.settings
        };
    });
};

describe('Integration: Component: gh-mailchimp-settings', function() {
    setupComponentTest('gh-mailchimp-settings', {
        integration: true
    });

    let server;

    beforeEach(async function () {
        // stub new mailchimp integration (normally created in route model hook)

        this.register('object:mailchimp-integration', MailchimpIntegration, {singleton: false});
        let factory = getOwner(this).factoryFor('object:mailchimp-integration');

        this.set('mailchimp', factory.create({
            isActive: true,
            apiKey: 'valid',
            activeList: {
                id: 'test1',
                name: 'Test List One'
            }
        }));

        // stub and inject feature service (we only care about subscribers flag)
        this.register('service:feature', featureStub);
        this.inject.service('feature', {as: 'feature'});

        // inject real settings to give access to it in the test context
        this.inject.service('settings');
        this.inject.service('notifications');

        // load mirage, fixtures, and mock the endpoints we care about
        server = startMirage();
        server.loadFixtures();
        mockMailchimp(server);
        mockSettings(server);

        // update scheduling fixtures with some known values for the tests
        let lastSyncAt = moment().subtract(1, 'hour').valueOf();
        let nextSyncAt = moment(lastSyncAt).add(1, 'day').valueOf();
        server.db.settings.update(
            {key: 'scheduling'},
            {value: `{"readonly":true,"subscribers":{"lastSyncAt":${lastSyncAt},"nextSyncAt":${nextSyncAt}}}`}
        );

        // fetch settings to simulate synchronous access
        await this.get('settings').fetch();
    });

    afterEach(function () {
        server.shutdown();
    });

    describe('subscribers disabled warning', function () {
        it('isn\'t shown when enabled', function () {
            this.set('feature', {subscribers: true});
            this.render(hbs`{{gh-mailchimp-settings}}`);

            expect(find('[data-test-subscribers-warning]')).to.not.exist;
        });

        it('is shown when disabled', function () {
            this.set('feature.subscribers', false);
            this.render(hbs`{{gh-mailchimp-settings}}`);

            expect(find('[data-test-subscribers-warning]')).to.exist;
        });
    });

    it('loads mailchimp lists when rendering', async function () {
        this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
        await wait();

        let select = find('[data-test-select="lists"]');

        expect(select, 'lists select element').to.exist;
        expect(select.options.length, 'number of options').to.equal(2);
        expect(select.options.item(0).value, 'first item value').to.equal('test1');
        expect(select.options.item(0).text, 'first item text').to.equal('Test List One');
        expect(select.options.item(1).value, 'second item value').to.equal('test2');
        expect(select.options.item(1).text, 'second item text').to.equal('Test List Two');
    });

    describe('enable checkbox', function () {
        it('toggles mailchimp.isActive', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            expect(this.get('mailchimp.isActive')).to.be.true;
            await click('[data-test-checkbox="isActive"]');
            expect(this.get('mailchimp.isActive')).to.be.false;
            await click('[data-test-checkbox="isActive"]');
            expect(this.get('mailchimp.isActive')).to.be.true;
        });

        it('can\'t be checked with missing api key');
        it('can\'t be checked invalid api key');
        it('can\'t be checked with no active list');
    });

    describe('api key input', function () {
        it('updates mailchimp.apiKey', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            expect(this.get('mailchimp.apiKey')).to.equal('valid');
            await(fillIn('[data-test-input="apiKey"]', 'new'));
            expect(this.get('mailchimp.apiKey')).to.equal('new');
        });

        it('triggers fetchLists on blur');
        it('shows error for invalid format');
        it('shows error for invalid key');
    });

    describe('fetchLists', function () {
        it('selects active list after load');
        it('selects first list if no list matches active list');
        it('clears mailchimp.activeList if no lists are returned');
        it('handles validation error');
        it('handles other server errors');
    });

    describe('saving', function () {
        it('is triggered by CMD-S', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            await keyEvent(document, 'keydown', 83, {metaKey: true});

            expect(
                find('[data-test-button="save"]').textContent.trim()
            ).to.have.string('Saved');
        });

        it('is prevented when api key is missing', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            this.set('mailchimp.apiKey', '');

            await click('[data-test-button="save"]');

            expect(
                find('[data-test-button="save"]').textContent.trim()
            ).to.have.string('Retry');

            expect(
                server.pretender.handledRequests.filterBy('method', 'PUT').length
            ).to.equal(0);
        });

        it('is prevented when api key is invalid');
        it('is prevented when list is missing');

        it('correctly updates settings', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            await fillIn('[data-test-input="apiKey"]', 'valid2');
            await triggerEvent('[data-test-input="apiKey"]', 'blur');

            let select = find('[data-test-select="lists"]');
            select.options.item(0).selected = true;
            await triggerEvent(select, 'change');

            mockSettingsPoll(server);
            await click('[data-test-button="save"]');

            let settings = JSON.parse(server.db.settings.findBy({key: 'mailchimp'}).value);
            expect(settings.apiKey).to.equal('valid2');
            expect(settings.activeList.id).to.equal('test3');
            expect(settings.activeList.name).to.equal('Test List Three');
        });

        it('handles server error', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            server.put('/settings/', {
                errors: [{
                    errorType: 'InternalServerError',
                    message: 'A test error occurred'
                }]
            }, 500);

            errorOverride();
            await click('[data-test-button="save"]');
            errorReset();

            // alerts aren't rendered in integration tests so check the service
            expect(
                this.get('notifications.alerts.length'),
                'number of alerts'
            ).to.equal(1);
            expect(
                this.get('notifications.alerts.firstObject.message')
            ).to.have.string('A test error occurred');
        });

        it('triggers sync poll when becoming active');
        it('triggers sync poll when active list has changed');

        it('resets settings if save fails', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            // change the list ID then save
            this.set('mailchimp.activeList.id', 'new');
            expect(this.get('settings.mailchimp.activeList.id')).to.equal('test1');

            server.put('/settings/', {
                errors: [{
                    errorType: 'ValidationError',
                    message: 'API Key Invalid'
                }]
            }, 422);

            errorOverride();
            await click('[data-test-button="save"]');
            errorReset();

            // save updates settings but the attributes should have been rolled
            // back on failure
            expect(this.get('settings.mailchimp.activeList.id')).to.equal('test1');
        });
    });

    describe('sync details', function () {
        it('shows last and next sync', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            let syncDetails = find('[data-test-sync-info]').textContent.trim().replace(/\s\s/g, '');

            expect(syncDetails)
                .to.have.string('Last synced an hour ago.');
            expect(syncDetails)
                .to.have.string('Next sync in: 23 hours.');
        });

        it('isn\'t shown when scheduling is empty', async function () {
            this.set('settings.scheduling', {});
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            expect(find('[data-test-sync-info]').textContent).to.be.blank;
        });

        it('shows next sync in hours or minutes', async function () {
            this.set('settings.scheduling.subscribers.nextSyncAt', moment().add(5, 'hours').add(30, 'minutes').valueOf());
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            // shows hours if > 1 hour
            expect(find('[data-test-sync-info]').textContent.trim().replace(/\s\s/g, ''))
                .to.have.string('Next sync in: 5 hours.');

            // shows minutes if < 1 hour
            this.set('settings.scheduling.subscribers.nextSyncAt', moment().add(30, 'minutes').valueOf());
            expect(find('[data-test-sync-info]').textContent.trim().replace(/\s\s/g, ''))
                .to.have.string('Next sync in: 30 minutes.');

            // if < 0.5 minutes, shows 1 minute not 0
            this.set('settings.scheduling.subscribers.nextSyncAt', moment().add(10, 'seconds').valueOf());
            expect(find('[data-test-sync-info]').textContent.trim().replace(/\s\s/g, ''))
                .to.have.string('Next sync in: 1 minute.');
        });

        it('shows last sync in bold when < 5 minutes ago', async function () {
            this.set('settings.scheduling.subscribers.lastSyncAt', moment().subtract(4, 'minutes').valueOf());
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            expect(find('[data-test-sync-info] strong').textContent)
                .to.have.string('4 minutes ago');

            this.set('settings.scheduling.subscribers.lastSyncAt', moment().subtract(6, 'minutes').valueOf());

            expect(find('[data-test-sync-info] strong')).to.not.exist;
        });

        it('hides sync details after list changes', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            expect(find('[data-test-sync-info]')).to.exist;

            let select = find('[data-test-select="lists"]');

            expect(select.options.item(0).selected).to.be.true;

            select.options.item(1).selected = true;
            await triggerEvent(select, 'change');

            expect(find('[data-test-sync-info]')).to.not.exist;
        });

        it('hides next sync when disabled', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            // verify initial state
            expect(find('[data-test-sync-info]').textContent, 'initial state').to.have.string('Next sync in');

            // disable
            await click('[data-test-checkbox="isActive"]');
            expect(find('[data-test-sync-info]').textContent).to.not.have.string('Next sync in');

            // re-enable
            await click('[data-test-checkbox="isActive"]');
            expect(find('[data-test-sync-info]').textContent).to.have.string('Next sync in');
        });

        it('shows next sync after sync polling', async function () {
            this.render(hbs`{{gh-mailchimp-settings mailchimp=mailchimp}}`);
            await wait();

            // verify initial state
            expect(
                find('[data-test-sync-info]').textContent, 'initial state'
            ).to.have.string('Last synced an hour ago.');

            // change the list
            let select = find('[data-test-select="lists"]');
            select.options.item(1).selected = true;
            await triggerEvent(select, 'change');

            // save and poll
            mockSettingsPoll(server);
            await click('[data-test-button="save"]');

            // check details were updated and displayed
            let syncDetails = find('[data-test-sync-info]').textContent.trim();
            expect(syncDetails).to.have.string('Last synced a few seconds ago.');
            expect(syncDetails).to.have.string('Next sync in: 24 hours');
        });
    });
});
