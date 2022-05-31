import { Sequelize } from 'sequelize';

export const sequelize = new Sequelize('Chainlink-Prices', 'ACY', 'PASSWORD', {
    dialect: 'sqlite',
    // TODO: change storage path name
    storage: 'dev.sqlite',
    logging: false
});