const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const DataLoader = require('../');

const {
    Observable
} = require('rxjs');
const {
    graphql,
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLString,
    GraphQLInt,
    GraphQLBoolean,
    GraphQLList,
    GraphQLNonNull
} = require('graphql');

chai.use(sinonChai);

const expect = chai.expect;
const users = [{
    id: 0,
    name: 'Philip'
}, {
    id: 1,
    name: 'David'
}, {
    id: 2,
    name: 'John'
}, {
    id: 3,
    name: 'George'
}];

const friendsOf = [
    [1, 2, 3],
    [0, 2, 3],
    [0, 1, 3],
    [0, 1, 2]
];

const getUser = sinon.spy(id => Observable.create(subscriber => {
    if (!users[id]) {
        subscriber.error(new Error('no user id'));
    }

    subscriber.next(users[id]);
    subscriber.complete();
}).share());

const User = new GraphQLObjectType({
    name: 'User',
    fields: () => ({
        name: {
            type: GraphQLString
        },
        friends: {
            type: new GraphQLList(User),
            resolve: ({
                id
            }, args, context) => {
                const {
                    userLoader
                } = context;

                return Observable.from(friendsOf[id])
                    .mergeMap(id => userLoader ? userLoader.get(id) : getUser(id))
                    .toArray()
                    .toPromise();
            }
        }
    })
});

const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
        name: 'Query',
        fields: {
            user: {
                type: User,
                args: {
                    id: {
                        type: new GraphQLNonNull(GraphQLInt)
                    },
                    useLoader: {
                        type: GraphQLBoolean
                    }
                },
                resolve: (root, {
                    id,
                    useLoader
                }, context, info) => {
                    if (useLoader) {
                        const userLoader = context.userLoader = new DataLoader(getUser);

                        return userLoader.get(id)
                            .toPromise();
                    }

                    return getUser(id)
                        .toPromise();
                }
            }
        }
    })
});

const asyncGraph = requestString => Observable.fromPromise(graphql(schema, requestString, {}, {}))
    .do(response => {
        if (response.errors) {
            throw new Error(response.errors.join());
        }
    });

const query = (id, useLoader = false) => `{
    user(id: ${id}, useLoader: ${useLoader}) {
        name
        friends {
            name
            friends {
                name
                friends {
                    name
                    friends {
                        name
                    }
                }
            }
        }
    }
}`;

describe('index.js', () => {
    let dataLoader;
    let loader;

    beforeEach(() => {
        loader = sinon.spy((key, error = null) => Observable.create(subscriber => {
            if (error) {
                return subscriber.error(error);
            }

            subscriber.next(key);
            subscriber.complete();
        }));

        dataLoader = new DataLoader(loader);
    });

    describe('constructor', () => {
        it('should throw if no loader', () => {
            expect(() => new DataLoader()).to.throw('loader might be a function.');
        });

        it('should throw if loader is not a function', () => {
            expect(() => new DataLoader('string')).to.throw('loader might be a function.');
        });

        it('should have a loader', () => {
            expect(dataLoader.loader).to.be.a('function');
        });

        it('should have a queue', () => {
            expect(dataLoader.queue).to.be.an('array');
        });

        it('should have a cache', () => {
            expect(dataLoader.cache).to.be.a('Map');
        });
    });

    describe('get', () => {
        beforeEach(() => {
            sinon.spy(dataLoader, 'buildCacheKey');
            sinon.spy(dataLoader, 'schedule');
            sinon.spy(dataLoader, 'dispatch');
            sinon.spy(dataLoader.cache, 'get');
            sinon.spy(dataLoader.cache, 'set');
        });

        afterEach(() => {
            dataLoader.buildCacheKey.restore();
            dataLoader.schedule.restore();
            dataLoader.dispatch.restore();
            dataLoader.cache.get.restore();
            dataLoader.cache.set.restore();
        });

        it('should throw if no args', done => {
            dataLoader.get()
                .subscribe(null, err => {
                    expect(err.message).to.equal('args are missing.');
                    done();
                });
        });

        it('should call buildCacheKey', done => {
            dataLoader.get(0)
                .subscribe(() => {
                    expect(dataLoader.buildCacheKey).to.have.been.calledWith(0);
                }, null, done);
        });

        it('should consult cache', done => {
            dataLoader.get(0)
                .subscribe(() => {
                    expect(dataLoader.cache.get).to.have.been.calledWith(0);
                }, null, done);
        });

        it('should return', done => {
            dataLoader.get(0)
                .merge(dataLoader.get(0))
                .merge(dataLoader.get(1))
                .merge(dataLoader.get(1))
                .toArray()
                .subscribe(response => {
                    expect(response).to.deep.equal([0, 0, 1, 1]);
                }, null, done);
        });

        it('should return different Observables if different keys', () => {
            expect(dataLoader.get(0)).not.to.equal(dataLoader.get(1));
        });

        it('should return cached Observables if same key', () => {
            expect(dataLoader.get(0)).to.equal(dataLoader.get(0));
        });

        it('should set cache if not exists', done => {
            dataLoader.get(0)
                .subscribe(() => {
                    expect(dataLoader.cache.set).to.have.been.calledOnce;
                    expect(dataLoader.cache.set).to.have.been.calledWith(0);
                }, null, done);
        });

        it('should not set cache if exists', done => {
            dataLoader.get(0)
                .merge(dataLoader.get(0))
                .merge(dataLoader.get(1))
                .merge(dataLoader.get(1))
                .toArray()
                .subscribe(() => {
                    expect(dataLoader.cache.set).to.have.been.calledTwice;
                    expect(dataLoader.cache.set).to.have.been.calledWith(0);
                    expect(dataLoader.cache.set).to.have.been.calledWith(1);
                }, null, done);
        });

        it('should call schedule when queue goes from 0 to 1', done => {
            dataLoader.get(0)
                .merge(dataLoader.get(0))
                .merge(dataLoader.get(1))
                .merge(dataLoader.get(1))
                .toArray()
                .subscribe(() => {
                    expect(dataLoader.schedule).to.have.been.calledOnce;
                }, null, done);
        });

        it('should call dispatch when queue goes from 0 to 1', done => {
            dataLoader.get(0)
                .merge(dataLoader.get(0))
                .merge(dataLoader.get(1))
                .merge(dataLoader.get(1))
                .toArray()
                .subscribe(() => {
                    expect(dataLoader.dispatch).to.have.been.calledOnce;
                }, null, done);
        });
    });

    describe('schedule', () => {
        beforeEach(() => {
            sinon.spy(process, 'nextTick');
        });

        afterEach(() => {
            process.nextTick.restore();
        });

        it('should call process.nextTick', () => {
            const fn = () => null;

            dataLoader.schedule(fn);
            expect(process.nextTick).to.have.been.calledWith(fn);
        });
    });

    describe('dispatch', () => {
        it('should call loader one per different item on the queue', done => {
            dataLoader.get(0)
                .merge(dataLoader.get(0))
                .merge(dataLoader.get(1))
                .merge(dataLoader.get(1))
                .toArray()
                .subscribe(() => {
                    expect(loader).to.have.been.calledTwice;
                    expect(loader).to.have.been.calledWith(0);
                    expect(loader).to.have.been.calledWith(1);
                }, null, done);
        });
    });

    describe('buldCacheKey', () => {
        it('should build cahce key with primitives', () => {
            expect(dataLoader.buildCacheKey(0)).to.equal(0);
            expect(dataLoader.buildCacheKey('string')).to.equal('string');
            expect(dataLoader.buildCacheKey(true)).to.equal(true);
        });

        it('should build cahce key with objects', () => {
            expect(dataLoader.buildCacheKey(null)).to.equal('null');
            expect(dataLoader.buildCacheKey({
                id: 0
            })).to.equal(JSON.stringify({
                id: 0
            }));
        });
    });

    describe('bdd with graphQl', () => {
        beforeEach(() => {
            getUser.reset();
        });

        it('should call getUser many times', done => {
            asyncGraph(query(0))
                .subscribe(null, null, () => {
                    expect(getUser.callCount).to.equal(121);
                    done();
                });
        });

        it('should call getUser once per user', done => {
            asyncGraph(query(0, true))
                .subscribe(null, null, () => {
                    expect(getUser.callCount).to.equal(4);
                    done();
                });
        });

        it('should handle errors', done => {
            asyncGraph(query(4))
                .subscribe(null, err => {
                    expect(err.message).to.equal('GraphQLError: no user id');
                    done();
                });
        });
    });
});