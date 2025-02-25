import {
    Autowired,
    Bean,
    BeanStub,
    ChangedPath,
    ColDef,
    Column,
    ColumnModel,
    IRowNodeStage,
    RowNode,
    StageExecuteParams,
    ValueService,
    _
} from "@ag-grid-community/core";
import { PivotColDefService } from "./pivotColDefService";

@Bean('pivotStage')
export class PivotStage extends BeanStub implements IRowNodeStage {

    // these should go into the pivot column creator
    @Autowired('valueService') private valueService: ValueService;
    @Autowired('columnModel') private columnModel: ColumnModel;
    @Autowired('pivotColDefService') private pivotColDefService: PivotColDefService;

    private uniqueValues: any = {};

    private pivotColumnDefs: ColDef[];

    private aggregationColumnsHashLastTime: string | null;
    private aggregationFuncsHashLastTime: string;

    public execute(params: StageExecuteParams): void {
        const rootNode = params.rowNode;
        const changedPath = params.changedPath;
        if (this.columnModel.isPivotActive()) {
            this.executePivotOn(rootNode, changedPath);
        } else {
            this.executePivotOff(changedPath);
        }
    }

    private executePivotOff(changedPath: ChangedPath | undefined): void {
        this.aggregationColumnsHashLastTime = null;
        this.uniqueValues = {};
        if (this.columnModel.isSecondaryColumnsPresent()) {
            this.columnModel.setSecondaryColumns(null, "rowModelUpdated");
            if (changedPath) {
                changedPath.setInactive();
            }
        }
    }

    private executePivotOn(rootNode: RowNode, changedPath: ChangedPath | undefined): void {
        const uniqueValues = this.bucketUpRowNodes(rootNode);

        const uniqueValuesChanged = this.setUniqueValues(uniqueValues);

        const aggregationColumns = this.columnModel.getValueColumns();
        const aggregationColumnsHash = aggregationColumns.map((column) => column.getId()).join('#');
        const aggregationFuncsHash = aggregationColumns.map((column) => column.getAggFunc()!.toString()).join('#');

        const aggregationColumnsChanged = this.aggregationColumnsHashLastTime !== aggregationColumnsHash;
        const aggregationFuncsChanged = this.aggregationFuncsHashLastTime !== aggregationFuncsHash;
        this.aggregationColumnsHashLastTime = aggregationColumnsHash;
        this.aggregationFuncsHashLastTime = aggregationFuncsHash;

        if (uniqueValuesChanged || aggregationColumnsChanged || aggregationFuncsChanged) {
            const {pivotColumnGroupDefs, pivotColumnDefs} = this.pivotColDefService.createPivotColumnDefs(this.uniqueValues);
            this.pivotColumnDefs = pivotColumnDefs;
            this.columnModel.setSecondaryColumns(pivotColumnGroupDefs, "rowModelUpdated");
            // because the secondary columns have changed, then the aggregation needs to visit the whole
            // tree again, so we make the changedPath not active, to force aggregation to visit all paths.
            if (changedPath) {
                changedPath.setInactive();
            }
        }
    }

    private setUniqueValues(newValues: any): boolean {
        const json1 = JSON.stringify(newValues);
        const json2 = JSON.stringify(this.uniqueValues);

        const uniqueValuesChanged = json1 !== json2;

        // we only continue the below if the unique values are different, as otherwise
        // the result will be the same as the last time we did it
        if (uniqueValuesChanged) {
            this.uniqueValues = newValues;
            return true;
        } else {
            return false;
        }
    }

    // returns true if values were different
    private bucketUpRowNodes(rootNode: RowNode): any {

        // accessed from inside inner function
        const uniqueValues: any = {};

        // finds all leaf groups and calls mapRowNode with it
        const recursivelySearchForLeafNodes = (rowNode: RowNode) => {
            if (rowNode.leafGroup) {
                this.bucketRowNode(rowNode, uniqueValues);
            } else {
                rowNode.childrenAfterFilter!.forEach(child => {
                    recursivelySearchForLeafNodes(child);
                });
            }
        };

        recursivelySearchForLeafNodes(rootNode);

        return uniqueValues;
    }

    private bucketRowNode(rowNode: RowNode, uniqueValues: any): void {

        const pivotColumns = this.columnModel.getPivotColumns();

        if (pivotColumns.length === 0) {
            rowNode.childrenMapped = null;
        } else {
            rowNode.childrenMapped = this.bucketChildren(rowNode.childrenAfterFilter!, pivotColumns, 0, uniqueValues);
        }

        if (rowNode.sibling) {
            rowNode.sibling.childrenMapped = rowNode.childrenMapped;
        }
    }

    private bucketChildren(children: RowNode[], pivotColumns: Column[], pivotIndex: number, uniqueValues: any): any {

        const mappedChildren: any = {};
        const pivotColumn = pivotColumns[pivotIndex];

        // map the children out based on the pivot column
        children.forEach((child: RowNode) => {
            let key: string = this.valueService.getKeyForNode(pivotColumn, child);

            if (_.missing(key)) {
                key = '';
            }

            if (!uniqueValues[key]) {
                uniqueValues[key] = {};
            }

            if (!mappedChildren[key]) {
                mappedChildren[key] = [];
            }
            mappedChildren[key].push(child);
        });

        // if it's the last pivot column, return as is, otherwise go one level further in the map
        if (pivotIndex === pivotColumns.length - 1) {
            return mappedChildren;
        } else {
            const result: any = {};

            _.iterateObject(mappedChildren, (key: string, value: RowNode[]) => {
                result[key] = this.bucketChildren(value, pivotColumns, pivotIndex + 1, uniqueValues[key]);
            });

            return result;
        }
    }

    public getPivotColumnDefs(): ColDef[] {
        return this.pivotColumnDefs;
    }

}
